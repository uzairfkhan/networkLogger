/**
 * Isolated world content script — relays captured body data from the
 * MAIN world interceptor to the service worker via chrome.runtime.sendMessage.
 */

(function () {
  'use strict';

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || !event.data.__networkLogger) return;

    try {
      chrome.runtime.sendMessage({
        type: 'BODY_CAPTURED',
        data: event.data.data,
      });
    } catch {
      // Extension context invalidated (e.g., extension updated/reloaded)
    }
  });
})();
