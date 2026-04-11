/**
 * Service worker — orchestrator: listeners, messages, alarms.
 */

import { MSG, DEFAULTS, ALARMS, STORAGE_KEYS } from '../shared/constants.js';
import { setFilter, shouldLog } from './domain-filter.js';
import { register as registerWebRequest } from './web-request-listener.js';
import * as store from './request-store.js';

let currentSettings = { ...DEFAULTS };
let paused = false;

// --- Top-level synchronous registration (MV3 service worker wakeup requirement) ---
// webRequest listeners MUST be attached synchronously on every SW startup so that
// events that wake the worker are delivered. Registering inside an async init
// after an `await` drops events that fire before the await resolves.
registerWebRequest();

// --- Initialization ---

async function initialize() {
  // Load settings
  try {
    const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    if (data[STORAGE_KEYS.SETTINGS]) {
      currentSettings = { ...DEFAULTS, ...data[STORAGE_KEYS.SETTINGS] };
    }
  } catch (e) {
    console.warn('[NetworkLogger] Failed to load settings:', e);
  }

  paused = currentSettings.paused || false;
  setFilter(currentSettings.filterMode, currentSettings.domainList);
  await store.init(currentSettings);
  store.cleanup();

  // Set up periodic cleanup alarm
  chrome.alarms.create(ALARMS.CLEANUP, { periodInMinutes: 1 });

  // Update badge
  updateBadge();

  console.log('[NetworkLogger] Service worker initialized');
}

initialize();

// --- Alarms ---

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARMS.CLEANUP) {
    store.cleanup();
  }
});

// --- Messages ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case MSG.BODY_CAPTURED: {
      if (paused) return { ok: true };
      const bodyData = message.data;
      if (!shouldLog(bodyData.url)) return { ok: true };
      if (sender.tab) bodyData.tabId = sender.tab.id;
      store.mergeBody(bodyData);
      return { ok: true };
    }

    case MSG.GET_ENTRIES:
      return { entries: store.getAll() };

    case MSG.CLEAR_ENTRIES:
      store.clear();
      return { ok: true };

    case MSG.GET_SETTINGS:
      return { settings: currentSettings };

    case MSG.UPDATE_SETTINGS: {
      currentSettings = { ...currentSettings, ...message.settings };
      paused = currentSettings.paused || false;
      setFilter(currentSettings.filterMode, currentSettings.domainList);
      store.updateSettings(currentSettings);
      store.cleanup();
      await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: currentSettings });
      updateBadge();
      return { ok: true };
    }

    case MSG.GET_STATS:
      return { stats: store.getStats() };

    case MSG.PAUSE:
      paused = true;
      currentSettings.paused = true;
      await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: currentSettings });
      updateBadge();
      return { ok: true };

    case MSG.RESUME:
      paused = false;
      currentSettings.paused = false;
      await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: currentSettings });
      updateBadge();
      return { ok: true };

    default:
      return { error: 'Unknown message type' };
  }
}

// --- Port connections (DevTools panel subscriptions) ---

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'networkLogger_devtools') {
    store.subscribe(port);
  }
});

// --- Badge ---

function updateBadge() {
  const text = paused ? '||' : '';
  const color = paused ? '#f44336' : '#4CAF50';
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// --- Install handler: inject content scripts into existing tabs ---

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        continue;
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ['src/content/network-interceptor-bridge.js'],
        });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ['src/content/network-interceptor.js'],
          world: 'MAIN',
        });
      } catch {
        // tab may not be scriptable
      }
    }
  }
});
