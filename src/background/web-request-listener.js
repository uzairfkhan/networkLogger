/**
 * chrome.webRequest event handlers — captures metadata from all requests.
 */

import { shouldLog } from './domain-filter.js';
import { upsert } from './request-store.js';
import { SKIP_BODY_TYPES } from '../shared/constants.js';

/** Pending requests awaiting completion (track timing). */
const pending = new Map();

export function register() {
  const filter = { urls: ['<all_urls>'] };

  chrome.webRequest.onBeforeRequest.addListener(
    onBeforeRequest,
    filter,
    ['requestBody']
  );

  chrome.webRequest.onSendHeaders.addListener(
    onSendHeaders,
    filter,
    ['requestHeaders']
  );

  chrome.webRequest.onHeadersReceived.addListener(
    onHeadersReceived,
    filter,
    ['responseHeaders']
  );

  chrome.webRequest.onCompleted.addListener(onCompleted, filter);
  chrome.webRequest.onErrorOccurred.addListener(onErrorOccurred, filter);
}

function onBeforeRequest(details) {
  if (!shouldLog(details.url)) return;
  if (isExtensionRequest(details.url)) return;

  const id = String(details.requestId);
  const entry = {
    timestamp: Date.now(),
    url: details.url,
    method: details.method,
    type: details.type,
    tabId: details.tabId,
    statusCode: null,
    statusText: '',
    requestHeaders: null,
    requestBody: null,
    responseHeaders: null,
    responseBody: null,
    size: null,
    duration: null,
    source: 'webRequest',
    hasBody: false,
  };

  // Capture request body from webRequest if available
  if (details.requestBody) {
    if (details.requestBody.raw) {
      try {
        const decoder = new TextDecoder();
        const parts = details.requestBody.raw.map(r => {
          if (r.bytes) return decoder.decode(r.bytes);
          return '[file upload]';
        });
        entry.requestBody = parts.join('');
        entry.hasBody = true;
      } catch { /* ignore */ }
    } else if (details.requestBody.formData) {
      entry.requestBody = JSON.stringify(details.requestBody.formData);
      entry.hasBody = true;
    }
  }

  pending.set(id, details.timeStamp);
  upsert(id, entry);
}

function onSendHeaders(details) {
  if (!shouldLog(details.url)) return;
  if (isExtensionRequest(details.url)) return;

  const id = String(details.requestId);
  const headers = headersArrayToObject(details.requestHeaders);
  upsert(id, { requestHeaders: headers });
}

function onHeadersReceived(details) {
  if (!shouldLog(details.url)) return;
  if (isExtensionRequest(details.url)) return;

  const id = String(details.requestId);
  const headers = headersArrayToObject(details.responseHeaders);
  upsert(id, {
    statusCode: details.statusCode,
    statusText: details.statusLine || '',
    responseHeaders: headers,
  });
}

function onCompleted(details) {
  if (!shouldLog(details.url)) return;
  if (isExtensionRequest(details.url)) return;

  const id = String(details.requestId);
  const startTime = pending.get(id);
  const duration = startTime ? Math.round(details.timeStamp - startTime) : null;
  pending.delete(id);

  upsert(id, {
    statusCode: details.statusCode,
    duration,
  });
}

function onErrorOccurred(details) {
  if (!shouldLog(details.url)) return;
  if (isExtensionRequest(details.url)) return;

  const id = String(details.requestId);
  const startTime = pending.get(id);
  const duration = startTime ? Math.round(details.timeStamp - startTime) : null;
  pending.delete(id);

  upsert(id, {
    statusCode: 0,
    statusText: details.error || 'Error',
    duration,
  });
}

function headersArrayToObject(headersArray) {
  if (!headersArray) return null;
  const obj = {};
  for (const h of headersArray) {
    obj[h.name] = h.value || '';
  }
  return obj;
}

function isExtensionRequest(url) {
  return url.startsWith('chrome-extension://') || url.startsWith('chrome://');
}
