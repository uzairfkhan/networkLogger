# Privacy Policy for NetRecall

**Last updated:** March 20, 2026

## Overview

NetRecall is a Chrome extension that captures and stores network request data locally on your device for debugging and development purposes. Your data never leaves your browser.

## Data Collection

NetRecall captures the following data from your browser's network activity:

- Request and response URLs
- HTTP methods and status codes
- Request and response headers
- Request and response bodies (up to a configurable size limit)
- Request timing and duration
- Resource type (fetch, XHR, etc.)

## Data Storage

- All captured data is stored **locally on your device** using Chrome's built-in storage APIs (`chrome.storage.session` and `chrome.storage.local`).
- Network request data is held in a **rolling buffer** (default 20 minutes) and is automatically deleted after the configured retention period.
- Response bodies are evicted after 5 minutes or sooner if storage limits are reached.
- No data is ever transmitted to any external server, third party, or remote endpoint.

## Data Sharing

NetRecall does **not** share, sell, transfer, or transmit any user data to any third party. All data remains entirely within your local browser environment.

## Permissions

NetRecall requires the following browser permissions:

| Permission | Purpose |
|---|---|
| `webRequest` | Monitor network requests to capture metadata (URLs, headers, status codes, timing) |
| `host_permissions (<all_urls>)` | Required to observe network requests across all websites |
| `storage` | Persist user settings (filter mode, buffer duration, etc.) locally |
| `tabs` | Identify which tab a network request originated from |
| `scripting` | Inject content scripts into open tabs on extension install/update to capture request and response bodies |

## User Control

- You can **pause and resume** network capture at any time via the extension popup.
- You can **clear all captured data** at any time via the popup or the DevTools panel.
- You can configure **domain filtering** (whitelist or blacklist) to limit which sites are monitored.
- You can adjust the **buffer duration** and **maximum body size** to control how much data is retained.
- Uninstalling the extension removes all stored data.

## Export

When you choose to export data (as HAR or JSON), the file is saved locally to your device. NetRecall does not upload exported files anywhere.

## Changes to This Policy

Any updates to this privacy policy will be reflected in this document with an updated revision date.

## Contact

If you have questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/user/networkLogger/issues).
