/**
 * Rolling buffer request store backed by chrome.storage.session.
 */

import { LIMITS, STORAGE_KEYS, SKIP_BODY_TYPES } from '../shared/constants.js';
import { shouldLog } from './domain-filter.js';

/** @type {Map<string, object>} */
const entries = new Map();

/** Subscribers (devtools panels) */
const subscribers = new Set();

let settings = { bufferMinutes: 20, maxBodySizeKB: 100 };

/**
 * Initialize store — rehydrate from chrome.storage.session.
 */
export async function init(currentSettings) {
  settings = { ...settings, ...currentSettings };
  try {
    const data = await chrome.storage.session.get(STORAGE_KEYS.ENTRIES);
    const saved = data[STORAGE_KEYS.ENTRIES];
    if (Array.isArray(saved)) {
      for (const entry of saved) {
        entries.set(entry.id, entry);
      }
    }
  } catch (e) {
    console.warn('[NetworkLogger] Failed to rehydrate store:', e);
  }
}

export function updateSettings(newSettings) {
  settings = { ...settings, ...newSettings };
}

/**
 * Add or update a network entry.
 */
export function upsert(id, data) {
  const existing = entries.get(id);
  const entry = existing ? { ...existing, ...data } : { id, ...data };

  // Enforce body size cap
  const maxBytes = (settings.maxBodySizeKB || 100) * 1024;
  if (entry.requestBody && entry.requestBody.length > maxBytes) {
    entry.requestBody = entry.requestBody.slice(0, maxBytes) + '\n[truncated]';
  }
  if (entry.responseBody && entry.responseBody.length > maxBytes) {
    entry.responseBody = entry.responseBody.slice(0, maxBytes) + '\n[truncated]';
  }

  entries.set(id, entry);
  notifySubscribers(existing ? 'ENTRY_UPDATED' : 'ENTRY_ADDED', entry);
  debouncedPersist();
}

/**
 * Merge body data from content scripts with existing webRequest entries.
 * Match by URL + method + close timestamp.
 */
export function mergeBody(bodyData) {
  // Find a matching entry without a body
  for (const [, entry] of entries) {
    if (
      entry.url === bodyData.url &&
      entry.method === bodyData.method &&
      !entry.responseBody &&
      Math.abs((entry.timestamp || 0) - (bodyData.timestamp || 0)) < 5000
    ) {
      if (bodyData.requestBody) entry.requestBody = bodyData.requestBody;
      if (bodyData.responseBody) entry.responseBody = bodyData.responseBody;
      entry.hasBody = true;
      entry.source = 'contentScript';
      notifySubscribers('ENTRY_UPDATED', entry);
      debouncedPersist();
      return;
    }
  }

  // No matching webRequest entry — create standalone entry from content script
  if (!shouldLog(bodyData.url)) return;
  const id = bodyData.id || crypto.randomUUID();
  const entry = {
    id,
    timestamp: bodyData.timestamp || Date.now(),
    url: bodyData.url,
    method: bodyData.method,
    statusCode: bodyData.statusCode || null,
    statusText: bodyData.statusText || '',
    type: bodyData.type || 'fetch',
    requestHeaders: bodyData.requestHeaders || null,
    requestBody: bodyData.requestBody || null,
    responseHeaders: bodyData.responseHeaders || null,
    responseBody: bodyData.responseBody || null,
    size: bodyData.size || null,
    duration: bodyData.duration || null,
    tabId: bodyData.tabId || null,
    source: 'contentScript',
    hasBody: !!(bodyData.requestBody || bodyData.responseBody),
  };
  entries.set(id, entry);
  notifySubscribers('ENTRY_ADDED', entry);
  debouncedPersist();
}

/**
 * Get all entries as array, sorted by timestamp.
 */
export function getAll() {
  return Array.from(entries.values()).sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Clear all entries.
 */
export function clear() {
  entries.clear();
  // Notify subscribers so live panels drop their local view.
  for (const port of subscribers) {
    try {
      port.postMessage({ type: 'ENTRIES_CLEARED' });
    } catch {
      subscribers.delete(port);
    }
  }
  persist();
}

/**
 * Cleanup: remove expired entries and evict old bodies under memory pressure.
 */
export function cleanup() {
  const now = Date.now();
  const bufferMs = (settings.bufferMinutes || 20) * 60 * 1000;
  const bodyRetainMs = LIMITS.BODY_EVICTION_MINUTES * 60 * 1000;

  // Remove entries older than buffer duration
  for (const [id, entry] of entries) {
    if (now - entry.timestamp > bufferMs) {
      entries.delete(id);
    }
  }

  // Evict bodies older than body retention period
  for (const [, entry] of entries) {
    if (now - entry.timestamp > bodyRetainMs) {
      if (entry.requestBody) {
        entry.requestBody = null;
      }
      if (entry.responseBody) {
        entry.responseBody = null;
      }
    }
  }

  // Check storage pressure and evict more bodies if needed
  evictBodiesUnderPressure();
  persist();
}

/**
 * If serialized size approaches limit, drop oldest bodies first.
 */
function evictBodiesUnderPressure() {
  const serialized = JSON.stringify(Array.from(entries.values()));
  let currentSize = new Blob([serialized]).size;

  if (currentSize < LIMITS.WARN_STORAGE_BYTES) return;

  // Sort entries by timestamp ascending (oldest first)
  const sorted = Array.from(entries.values())
    .filter(e => e.requestBody || e.responseBody)
    .sort((a, b) => a.timestamp - b.timestamp);

  for (const entry of sorted) {
    if (currentSize < LIMITS.WARN_STORAGE_BYTES) break;
    const bodySize = (entry.requestBody?.length || 0) + (entry.responseBody?.length || 0);
    entry.requestBody = null;
    entry.responseBody = null;
    currentSize -= bodySize;
  }
}

/**
 * Get stats for popup display.
 */
export function getStats() {
  const all = Array.from(entries.values());
  const withBody = all.filter(e => e.requestBody || e.responseBody);
  const serialized = JSON.stringify(all);
  return {
    totalEntries: all.length,
    entriesWithBody: withBody.length,
    estimatedSizeKB: Math.round(new Blob([serialized]).size / 1024),
    oldestTimestamp: all.length > 0 ? Math.min(...all.map(e => e.timestamp)) : null,
  };
}

// --- Subscribers ---

export function subscribe(port) {
  subscribers.add(port);
  port.onDisconnect.addListener(() => subscribers.delete(port));
}

function notifySubscribers(type, entry) {
  for (const port of subscribers) {
    try {
      port.postMessage({ type, entry });
    } catch {
      subscribers.delete(port);
    }
  }
}

// --- Persistence ---

let persistTimer = null;

function debouncedPersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persist();
  }, 1000);
}

async function persist() {
  try {
    const data = Array.from(entries.values());
    await chrome.storage.session.set({ [STORAGE_KEYS.ENTRIES]: data });
  } catch (e) {
    console.warn('[NetworkLogger] Failed to persist store:', e);
    // Hit quota (or transient error). Evict ALL bodies — metadata is cheap,
    // bodies are where the bytes actually are. evictBodiesUnderPressure()'s
    // threshold check is wrong here because we know we already blew the quota.
    for (const [, entry] of entries) {
      if (entry.requestBody) entry.requestBody = null;
      if (entry.responseBody) entry.responseBody = null;
    }
    try {
      const data = Array.from(entries.values());
      await chrome.storage.session.set({ [STORAGE_KEYS.ENTRIES]: data });
    } catch {
      // Still failing with only metadata — drop oldest half of entries.
      const sorted = Array.from(entries.values()).sort((a, b) => a.timestamp - b.timestamp);
      const dropCount = Math.ceil(sorted.length / 2);
      for (let i = 0; i < dropCount; i++) entries.delete(sorted[i].id);
      try {
        const data = Array.from(entries.values());
        await chrome.storage.session.set({ [STORAGE_KEYS.ENTRIES]: data });
      } catch {
        // give up for this cycle
      }
    }
  }
}
