# NetRecall

A Chrome extension that silently captures network requests in a rolling buffer, allowing you to inspect, filter, and export them at any time — even if DevTools was not open when the requests were made.

## Table of Contents

- [Problem](#problem)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Installation](#installation)
- [Usage](#usage)
  - [Popup Controls](#popup-controls)
  - [DevTools Panel](#devtools-panel)
  - [Filtering](#filtering)
  - [Request Detail View](#request-detail-view)
  - [Exporting Data](#exporting-data)
- [Configuration](#configuration)
- [Memory Management](#memory-management)
- [Permissions](#permissions)
- [Privacy](#privacy)
- [Development](#development)
- [Limitations](#limitations)

## Problem

Chrome DevTools only captures network activity while the Network tab is open. If a request fires before you open DevTools, or if you close and reopen the panel, that data is lost. NetRecall solves this by continuously recording network activity in the background, maintaining a configurable rolling buffer that you can browse at any time.

## How It Works

NetRecall uses a dual capture strategy to collect both request metadata and response bodies:

1. **chrome.webRequest API** — Listens to browser-level network events (`onBeforeRequest`, `onSendHeaders`, `onHeadersReceived`, `onCompleted`, `onErrorOccurred`) to capture metadata: URL, method, request headers, response headers, status codes, and timing. This runs in the background service worker and does not require any page injection.

2. **Content Script Interception** — Injects a script into the MAIN world of every page that monkey-patches `window.fetch` and `XMLHttpRequest`. This allows NetRecall to read request and response bodies, which are not accessible through the webRequest API in Manifest V3. The intercepted bodies are relayed from the MAIN world to an isolated world bridge script, which forwards them to the service worker via `chrome.runtime.sendMessage`.

3. **Body Merging** — When body data arrives from the content script, the service worker matches it to an existing webRequest entry by comparing URL, HTTP method, and timestamp proximity (within 5 seconds). If a match is found, the body data is merged into the existing entry. If no match is found, a standalone entry is created.

## Architecture

```
Page (MAIN world)                    Isolated World                 Service Worker
+---------------------------+       +---------------------+       +---------------------------+
| network-interceptor.js    |       | network-interceptor |       | service-worker.js         |
| - Patches fetch()         | ----> | -bridge.js          | ----> | - Orchestrates all modules|
| - Patches XMLHttpRequest  |  msg  | - Relays via        |  msg  | - Handles messages        |
| - Posts body data          |       |   chrome.runtime    |       | - Manages alarms          |
+---------------------------+       +---------------------+       +---------------------------+
                                                                    |
                                                           +--------+--------+--------+
                                                           |        |        |        |
                                                     web-request  request  domain   constants
                                                     -listener   -store   -filter
                                                     .js         .js      .js       .js

DevTools Panel                       Popup
+---------------------------+       +---------------------------+
| panel.js                  |       | popup.js                  |
| - Live request table      |       | - Pause / Resume          |
| - Detail view             |       | - Clear all entries        |
| - Filter, export          |       | - Filter mode + domains   |
| - Subscribes via port     |       | - Buffer / body settings  |
+---------------------------+       +---------------------------+
```

### File Structure

```
networkLogger/
  manifest.json                    Extension manifest (MV3)
  icons/
    icon16.png                     Toolbar icon
    icon48.png                     Extension management icon
    icon128.png                    Chrome Web Store icon
  src/
    shared/
      constants.js                 Message types, defaults, limits, storage keys
    background/
      service-worker.js            Main orchestrator: init, messages, alarms, badge
      web-request-listener.js      chrome.webRequest event handlers
      request-store.js             Rolling buffer store with persistence and subscriptions
      domain-filter.js             Whitelist/blacklist domain matching
    content/
      network-interceptor.js       MAIN world script: patches fetch and XHR
      network-interceptor-bridge.js  Isolated world relay to service worker
    popup/
      popup.html                   Popup UI
      popup.css                    Popup styles
      popup.js                     Popup logic: settings, stats, pause/resume
    devtools/
      devtools.html                DevTools page entry point
      devtools.js                  Creates the NetRecall panel
      panel/
        panel.html                 DevTools panel UI
        panel.css                  DevTools panel styles (dark/light theme)
        panel.js                   Panel logic: table, filters, detail view, export
```

## Installation

### From Chrome Web Store

Search for "NetRecall" in the Chrome Web Store and click "Add to Chrome".

### From Source (Developer Mode)

1. Clone or download this repository.
2. Open `chrome://extensions/` in Chrome.
3. Enable "Developer mode" using the toggle in the top-right corner.
4. Click "Load unpacked" and select the `networkLogger` directory.
5. The NetRecall icon will appear in your browser toolbar.

On install, the extension automatically injects content scripts into all existing open tabs so that body capture begins immediately without requiring a page reload.

## Usage

### Popup Controls

Click the NetRecall icon in the toolbar to open the popup. From here you can:

- **Pause / Resume** — Toggle network capture on and off. When paused, the toolbar badge shows "||" with a red background.
- **Clear All** — Delete all captured entries from the buffer.
- **Filter Mode** — Choose between "Off" (capture all), "Whitelist" (capture only listed domains), or "Blacklist" (capture everything except listed domains).
- **Domains** — Add or remove domains for the active filter mode. Supports subdomain matching (adding `example.com` will also match `api.example.com`).
- **Buffer Duration** — Set how long entries are retained before automatic deletion (1 to 60 minutes, default 20).
- **Max Body Size** — Set the maximum size for captured request and response bodies (1 to 1024 KB, default 100).
- **Stats** — View the current number of captured requests, how many have bodies, estimated storage usage, and the age of the oldest entry.

### DevTools Panel

1. Open Chrome DevTools (F12 or Ctrl+Shift+I).
2. Navigate to the "NetRecall" tab.

The panel displays a table of all captured requests with the following columns:

| Column | Description |
|--------|-------------|
| Status | HTTP status code, colored by range (green for 2xx, blue for 3xx, yellow for 4xx, red for 5xx/errors) |
| Method | HTTP method (POST, PUT, PATCH, DELETE are highlighted in orange) |
| URL    | Request path and query string |
| Type   | Resource type (fetch, xmlhttprequest, script, image, etc.) |
| Size   | Response body size |
| Time   | Request duration in milliseconds |

The table updates in real time as new requests are captured. Entries that are still pending show "..." for status and time.

### Filtering

The toolbar at the top of the DevTools panel provides three filters:

- **URL filter** — Free text search. Filters the table to entries whose URL contains the search string (case-insensitive).
- **Method filter** — Dropdown to show only requests with a specific HTTP method.
- **Status filter** — Dropdown to show only requests in a specific status code range (2xx, 3xx, 4xx, 5xx) or errors (status code 0).

Filters are applied in combination. The request count in the toolbar reflects the number of entries matching all active filters.

### Request Detail View

Click any row in the request table to open the detail pane on the right. The detail view has four tabs:

**Headers** — Shows general request information (URL, method, status, type, capture source) followed by response headers and request headers.

**Request** — Displays the request body. If the body is valid JSON, it is pretty-printed. If no body was captured, a message is shown.

**Response** — Displays the response body with the same formatting behavior as the request tab.

**Timing** — Shows the request start time (ISO 8601), duration in milliseconds, and the originating tab ID.

Additional actions in the detail view:

- **Copy cURL** — Copies the selected request as a cURL command to the clipboard, including method, headers, and body.
- **Close** — Closes the detail pane.

### Exporting Data

Two export formats are available from the DevTools panel toolbar:

- **Export HAR** — Downloads the currently filtered entries as an HTTP Archive (HAR 1.2) file. This format is compatible with Chrome DevTools (import via the Network tab), Charles Proxy, Fiddler, and other HTTP debugging tools.
- **Export JSON** — Downloads the currently filtered entries as a raw JSON array containing all captured fields.

Exports respect the active filters. Only entries visible in the table are included in the export.

## Configuration

All settings are persisted in `chrome.storage.local` and survive browser restarts.

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| Filter Mode | off | off / whitelist / blacklist | Controls which domains are captured |
| Domain List | (empty) | Any valid domain | Domains for whitelist or blacklist matching |
| Buffer Duration | 20 min | 1 - 60 min | How long entries are retained |
| Max Body Size | 100 KB | 1 - 1024 KB | Maximum size per request or response body |
| Paused | false | true / false | Whether capture is active |

## Memory Management

NetRecall implements several mechanisms to prevent excessive memory usage:

1. **Rolling Buffer** — Entries older than the configured buffer duration are automatically deleted every 60 seconds by a cleanup alarm.

2. **Body Eviction** — Response and request bodies are evicted (set to null) after 5 minutes, even if the entry itself is still within the buffer window. This keeps metadata available while reclaiming the bulk of the storage.

3. **Storage Pressure Eviction** — When the serialized size of all entries exceeds 8 MB, the extension aggressively evicts bodies starting with the oldest entries until the size drops below the threshold.

4. **Body Size Cap** — Individual request and response bodies are truncated to the configured maximum size (default 100 KB) at capture time.

5. **Session Storage Limit** — The extension uses `chrome.storage.session` for the request buffer, which has a 10 MB quota. If persistence fails due to quota errors, the extension triggers an additional round of body eviction and retries.

6. **Skipped Body Types** — Content scripts do not attempt to capture bodies for resource types that are typically binary or not useful for debugging: images, fonts, stylesheets, scripts, and media.

## Permissions

| Permission | Reason |
|------------|--------|
| `webRequest` | Listen to network request lifecycle events for metadata capture |
| `<all_urls>` (host) | Observe requests across all domains |
| `storage` | Persist user settings and the request buffer |
| `tabs` | Associate requests with their originating tab and inject scripts on install |
| `scripting` | Inject content scripts into existing tabs on install/update |
| `alarms` | Schedule periodic buffer cleanup |

## Privacy

- All data is stored locally on your device using Chrome's built-in storage APIs.
- No data is transmitted to any external server or third party.
- Captured data is automatically deleted after the configured buffer duration.
- Uninstalling the extension removes all stored data.
- See [privacy-policy.md](privacy-policy.md) for the full privacy policy.

## Development

To work on NetRecall locally:

1. Clone the repository.
2. Load the extension in developer mode (see [Installation](#installation)).
3. Make changes to the source files.
4. Click the reload button on `chrome://extensions/` to pick up changes to the service worker and background modules.
5. For content script changes, reload the target page as well.
6. For popup or DevTools panel changes, close and reopen the respective UI.

There is no build step. The extension uses native ES modules in the service worker and plain JavaScript elsewhere.

## Limitations

- **Response bodies in Manifest V3** — The chrome.webRequest API in MV3 does not provide access to response bodies. NetRecall works around this by injecting content scripts that patch fetch and XHR, but this approach cannot capture bodies for requests initiated by the browser itself (e.g., navigation requests, requests from other extensions, or requests from web workers).
- **Service worker lifecycle** — Chrome may terminate the service worker after a period of inactivity. The request buffer is persisted to `chrome.storage.session` to survive restarts, but in-flight requests at the time of termination may be lost.
- **Binary responses** — Only text-based response bodies are captured. Binary responses (images, protobuf, etc.) are not read by the content script interceptors.
- **Inaccessible pages** — Content scripts cannot be injected into `chrome://` pages, `chrome-extension://` pages, or the Chrome Web Store. Network metadata from webRequest is still captured for these pages, but bodies are not.
- **Cross-origin iframes** — Content scripts are injected into all frames (`all_frames: true`), but some cross-origin iframes with restrictive CSP policies may block the MAIN world script injection.
