# NetRecall

Chrome MV3 extension that silently records network requests into a rolling buffer so they can be inspected after the fact from a DevTools panel or popup. Plain JS, native ES modules, **no build step** — edit files and reload the extension.

## Architecture at a glance

Two capture paths, merged in the service worker:

1. **`chrome.webRequest`** (background) — metadata only: URL, method, headers, status, timing. Cannot access response bodies in MV3.
2. **MAIN-world content script** (`network-interceptor.js`) — monkey-patches `window.fetch` and `XMLHttpRequest` to grab request/response bodies. Relays via `network-interceptor-bridge.js` (isolated world) → `chrome.runtime.sendMessage` → service worker.

Service worker (`service-worker.js`) merges body data into the matching webRequest entry by **URL + method + timestamp proximity (≤5s)**. No match → standalone entry.

### Module map

- `src/shared/constants.js` — `MSG`, `DEFAULTS`, `LIMITS`, `SKIP_BODY_TYPES`, `ALARMS`, `STORAGE_KEYS`. Single source of truth for message names, settings, and thresholds.
- `src/background/service-worker.js` — orchestrator: init, message routing, alarms, badge.
- `src/background/web-request-listener.js` — `onBeforeRequest` / `onSendHeaders` / `onHeadersReceived` / `onCompleted` / `onErrorOccurred` handlers.
- `src/background/request-store.js` — in-memory rolling buffer, persistence to `chrome.storage.session`, port-based subscriptions for the devtools panel.
- `src/background/domain-filter.js` — whitelist/blacklist with subdomain matching.
- `src/content/network-interceptor.js` — MAIN world, patches fetch/XHR. Must run at `document_start`.
- `src/content/network-interceptor-bridge.js` — isolated world relay (MAIN world cannot call `chrome.runtime` directly).
- `src/devtools/panel/panel.js` — request table, filters, detail view, HAR/JSON export, cURL copy. Subscribes via long-lived port.
- `src/popup/popup.js` — pause/resume, clear, filter mode + domain list, buffer/body settings, stats.

## Non-obvious invariants

- **Buffer lives in `chrome.storage.session`** (10 MB quota), not `storage.local`. It intentionally does not survive browser restarts.
- **Settings live in `chrome.storage.local`** and do survive restarts.
- **Body eviction is independent of entry eviction**: bodies are nulled after `LIMITS.BODY_EVICTION_MINUTES` (5 min) even if the entry itself is kept. Under storage pressure (>8 MB), oldest bodies are evicted first.
- **Body capture is skipped** for `image / font / stylesheet / script / media` (see `SKIP_BODY_TYPES`).
- **Install hook re-injects content scripts** into already-open tabs so capture starts without a reload.
- **`all_frames: true`** — interceptor runs in subframes; some cross-origin iframes with strict CSP will block MAIN-world injection.
- Service worker may be terminated while idle. The buffer is persisted; in-flight requests may be lost on termination.

## When editing

- Changes to background/service-worker modules → click reload on `chrome://extensions/`.
- Changes to content scripts → reload the target page too.
- Changes to popup / devtools panel → close and reopen that UI.
- Adding a new message type: update `MSG` in `shared/constants.js` first, then sender and receiver.
- Don't introduce a build step or a framework — the project is deliberately dependency-free.
