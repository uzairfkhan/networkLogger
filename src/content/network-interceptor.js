/**
 * MAIN world content script — patches fetch and XHR to capture request/response bodies.
 * Communicates with the bridge script via window.postMessage.
 */

(function () {
  'use strict';

  if (window.__networkLoggerPatched) return;
  window.__networkLoggerPatched = true;

  const MAX_BODY_SIZE = 100 * 1024; // 100KB

  function clampBody(body) {
    if (!body) return null;
    if (typeof body !== 'string') {
      try { body = JSON.stringify(body); } catch { return null; }
    }
    if (body.length > MAX_BODY_SIZE) {
      return body.slice(0, MAX_BODY_SIZE) + '\n[truncated]';
    }
    return body;
  }

  function postCapture(data) {
    window.postMessage({
      __networkLogger: true,
      data,
    }, '*');
  }

  // --- Patch fetch ---

  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const startTime = Date.now();
    let url, method, requestBody, requestHeaders;

    try {
      if (args[0] instanceof Request) {
        const request = args[0];
        url = request.url;
        method = request.method;
        requestHeaders = {};
        request.headers.forEach((v, k) => { requestHeaders[k] = v; });
        // Clone to read body without consuming the original
        try {
          const cloned = request.clone();
          requestBody = await cloned.text();
        } catch { /* body already consumed or unreadable */ }
      } else {
        // String/URL input — extract directly from args WITHOUT constructing a
        // Request. Constructing `new Request(...args)` would lock a ReadableStream
        // body in init, causing the subsequent originalFetch call to fail.
        url = typeof args[0] === 'string' ? args[0] : String(args[0]);
        const init = args[1] || {};
        method = (init.method || 'GET').toUpperCase();
        requestHeaders = {};
        if (init.headers) {
          if (init.headers instanceof Headers) {
            init.headers.forEach((v, k) => { requestHeaders[k] = v; });
          } else if (Array.isArray(init.headers)) {
            for (const [k, v] of init.headers) requestHeaders[k] = v;
          } else {
            for (const k of Object.keys(init.headers)) requestHeaders[k] = init.headers[k];
          }
        }
        const b = init.body;
        if (b != null) {
          if (typeof b === 'string') {
            requestBody = b;
          } else if (b instanceof URLSearchParams) {
            requestBody = b.toString();
          } else if (b instanceof FormData) {
            requestBody = '[FormData]';
          } else if (typeof ReadableStream !== 'undefined' && b instanceof ReadableStream) {
            // Do not touch — reading would lock the stream and break the real fetch.
            requestBody = '[ReadableStream]';
          } else if (b instanceof Blob) {
            requestBody = '[Blob ' + b.size + ' bytes]';
          } else if (b instanceof ArrayBuffer || ArrayBuffer.isView(b)) {
            requestBody = '[binary ' + (b.byteLength || 0) + ' bytes]';
          } else {
            try { requestBody = JSON.stringify(b); } catch { requestBody = '[unreadable]'; }
          }
        }
      }
    } catch {
      return originalFetch.apply(this, args);
    }

    let response;
    try {
      response = await originalFetch.apply(this, args);
    } catch (err) {
      postCapture({
        id: crypto.randomUUID(),
        timestamp: startTime,
        url,
        method,
        type: 'fetch',
        statusCode: 0,
        statusText: err.message,
        requestHeaders,
        requestBody: clampBody(requestBody),
        responseBody: null,
        duration: Date.now() - startTime,
      });
      throw err;
    }

    // Read response body without interfering with caller
    const clonedResponse = response.clone();
    const responseHeaders = {};
    response.headers.forEach((v, k) => { responseHeaders[k] = v; });

    // Read body asynchronously so we don't block the caller
    clonedResponse.text().then(text => {
      postCapture({
        id: crypto.randomUUID(),
        timestamp: startTime,
        url,
        method,
        type: 'fetch',
        statusCode: response.status,
        statusText: response.statusText,
        requestHeaders,
        requestBody: clampBody(requestBody),
        responseHeaders,
        responseBody: clampBody(text),
        size: text.length,
        duration: Date.now() - startTime,
      });
    }).catch(() => {
      postCapture({
        id: crypto.randomUUID(),
        timestamp: startTime,
        url,
        method,
        type: 'fetch',
        statusCode: response.status,
        statusText: response.statusText,
        requestHeaders,
        requestBody: clampBody(requestBody),
        responseHeaders,
        responseBody: null,
        duration: Date.now() - startTime,
      });
    });

    return response;
  };

  // --- Patch XMLHttpRequest ---

  const XHR = XMLHttpRequest.prototype;
  const originalOpen = XHR.open;
  const originalSend = XHR.send;
  const originalSetRequestHeader = XHR.setRequestHeader;

  XHR.open = function (method, url, ...rest) {
    this.__nl = {
      method: method,
      url: String(url),
      requestHeaders: {},
      startTime: null,
    };
    return originalOpen.call(this, method, url, ...rest);
  };

  XHR.setRequestHeader = function (name, value) {
    if (this.__nl) {
      this.__nl.requestHeaders[name] = value;
    }
    return originalSetRequestHeader.call(this, name, value);
  };

  XHR.send = function (body) {
    if (this.__nl) {
      this.__nl.startTime = Date.now();
      this.__nl.requestBody = typeof body === 'string' ? body :
        body instanceof FormData ? '[FormData]' :
        body ? '[binary]' : null;

      this.addEventListener('loadend', function () {
        const nl = this.__nl;
        if (!nl) return;

        const responseHeaders = {};
        const rawHeaders = this.getAllResponseHeaders();
        if (rawHeaders) {
          rawHeaders.trim().split(/[\r\n]+/).forEach(line => {
            const idx = line.indexOf(':');
            if (idx > 0) {
              responseHeaders[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
            }
          });
        }

        let responseBody = null;
        try {
          if (this.responseType === '' || this.responseType === 'text') {
            responseBody = this.responseText;
          } else if (this.responseType === 'json') {
            responseBody = JSON.stringify(this.response);
          }
        } catch { /* ignore */ }

        postCapture({
          id: crypto.randomUUID(),
          timestamp: nl.startTime,
          url: nl.url,
          method: nl.method,
          type: 'xmlhttprequest',
          statusCode: this.status,
          statusText: this.statusText,
          requestHeaders: nl.requestHeaders,
          requestBody: clampBody(nl.requestBody),
          responseHeaders,
          responseBody: clampBody(responseBody),
          size: responseBody ? responseBody.length : null,
          duration: Date.now() - nl.startTime,
        });
      });
    }
    return originalSend.call(this, body);
  };
})();
