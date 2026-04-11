/**
 * DevTools panel logic — fetch data, render, filter, detail view, export.
 */

(function () {
  'use strict';

  const tbody = document.getElementById('request-tbody');
  const detailPane = document.getElementById('detail-pane');
  const detailTitle = document.getElementById('detail-title');
  const detailContent = document.getElementById('detail-content');
  const requestCount = document.getElementById('request-count');
  const filterUrl = document.getElementById('filter-url');
  const filterMethod = document.getElementById('filter-method');
  const filterStatus = document.getElementById('filter-status');

  let entries = [];
  let selectedId = null;
  let activeTab = 'headers';

  // --- Subscribe FIRST, snapshot SECOND ---
  // Otherwise any entry that arrives between the GET_ENTRIES response and the
  // port connect is either missed or duplicated (snapshot replaces entries[]
  // wholesale). Buffer incoming events while the snapshot is in flight and
  // reconcile by id when it lands.

  let snapshotArrived = false;
  const pendingEvents = [];

  const port = chrome.runtime.connect({ name: 'networkLogger_devtools' });

  port.onMessage.addListener((msg) => {
    if (!snapshotArrived) {
      pendingEvents.push(msg);
      return;
    }
    applyMessage(msg);
  });

  chrome.runtime.sendMessage({ type: 'GET_ENTRIES' }, (response) => {
    if (response?.entries) {
      entries = response.entries;
    }
    snapshotArrived = true;
    for (const msg of pendingEvents) applyMessage(msg);
    pendingEvents.length = 0;
    render();
  });

  function applyMessage(msg) {
    if (msg.type === 'ENTRY_ADDED') {
      const idx = entries.findIndex(e => e.id === msg.entry.id);
      if (idx >= 0) entries[idx] = msg.entry;
      else entries.push(msg.entry);
      render();
    } else if (msg.type === 'ENTRY_UPDATED') {
      const idx = entries.findIndex(e => e.id === msg.entry.id);
      if (idx >= 0) entries[idx] = msg.entry;
      else entries.push(msg.entry);
      render();
      if (selectedId === msg.entry.id) renderDetail(msg.entry);
    } else if (msg.type === 'ENTRIES_CLEARED') {
      entries = [];
      selectedId = null;
      detailPane.classList.remove('open');
      render();
    }
  }

  // --- Filters ---

  filterUrl.addEventListener('input', render);
  filterMethod.addEventListener('change', render);
  filterStatus.addEventListener('change', render);

  function getFiltered() {
    const urlFilter = filterUrl.value.toLowerCase();
    const methodFilter = filterMethod.value;
    const statusFilter = filterStatus.value;

    return entries.filter(e => {
      if (urlFilter && !e.url.toLowerCase().includes(urlFilter)) return false;
      if (methodFilter && e.method !== methodFilter) return false;
      if (statusFilter) {
        const s = e.statusCode;
        if (statusFilter === 'error' && s !== 0 && s !== null) return false;
        if (statusFilter === '2xx' && (s < 200 || s >= 300)) return false;
        if (statusFilter === '3xx' && (s < 300 || s >= 400)) return false;
        if (statusFilter === '4xx' && (s < 400 || s >= 500)) return false;
        if (statusFilter === '5xx' && (s < 500 || s >= 600)) return false;
      }
      return true;
    });
  }

  // --- Render ---

  function render() {
    const filtered = getFiltered();
    requestCount.textContent = filtered.length + ' request' + (filtered.length !== 1 ? 's' : '');

    // Build HTML in batch for performance
    const rows = filtered.map(entry => {
      const statusClass = getStatusClass(entry.statusCode);
      const methodClass = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.method)
        ? 'method-' + entry.method.toLowerCase() : '';
      const selected = entry.id === selectedId ? ' selected' : '';
      const displayUrl = getDisplayUrl(entry.url);
      const size = formatSize(entry.size);
      const time = entry.duration != null ? entry.duration + 'ms' : '...';
      const status = entry.statusCode === null ? '...' :
        entry.statusCode === 0 ? 'ERR' : entry.statusCode;

      return `<tr data-id="${entry.id}" class="${selected}">
        <td class="col-status ${statusClass}">${status}</td>
        <td class="col-method ${methodClass}">${entry.method || '-'}</td>
        <td class="col-url" title="${escapeHtml(entry.url)}">${escapeHtml(displayUrl)}</td>
        <td class="col-type">${entry.type || '-'}</td>
        <td class="col-size">${size}</td>
        <td class="col-time">${time}</td>
      </tr>`;
    }).join('');

    tbody.innerHTML = rows;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No requests captured yet</div></td></tr>`;
    }
  }

  // --- Row click ---

  tbody.addEventListener('click', (e) => {
    const row = e.target.closest('tr');
    if (!row || !row.dataset.id) return;

    selectedId = row.dataset.id;
    const entry = entries.find(e => e.id === selectedId);
    if (entry) {
      renderDetail(entry);
      detailPane.style.display = 'flex';
    }
    render();
  });

  // --- Detail pane ---

  document.getElementById('btn-close-detail').addEventListener('click', () => {
    detailPane.style.display = 'none';
    selectedId = null;
    render();
  });

  document.querySelectorAll('.detail-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.detail-tabs .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      const entry = entries.find(e => e.id === selectedId);
      if (entry) renderDetail(entry);
    });
  });

  function renderDetail(entry) {
    detailTitle.textContent = `${entry.method} ${getDisplayUrl(entry.url)}`;

    let html = '';
    switch (activeTab) {
      case 'headers':
        html = renderHeaders(entry);
        break;
      case 'request':
        html = renderBody('Request Body', entry.requestBody);
        break;
      case 'response':
        html = renderBody('Response Body', entry.responseBody);
        break;
      case 'timing':
        html = renderTiming(entry);
        break;
    }
    detailContent.innerHTML = html;
  }

  function renderHeaders(entry) {
    let html = '<div class="section-title">General</div>';
    html += headerRow('Request URL', entry.url);
    html += headerRow('Request Method', entry.method);
    html += headerRow('Status Code', entry.statusCode != null ? `${entry.statusCode} ${entry.statusText || ''}` : 'Pending');
    html += headerRow('Type', entry.type || '-');
    html += headerRow('Source', entry.source || '-');

    if (entry.responseHeaders) {
      html += '<div class="section-title">Response Headers</div>';
      for (const [k, v] of Object.entries(entry.responseHeaders)) {
        html += headerRow(k, v);
      }
    }

    if (entry.requestHeaders) {
      html += '<div class="section-title">Request Headers</div>';
      for (const [k, v] of Object.entries(entry.requestHeaders)) {
        html += headerRow(k, v);
      }
    }

    return html;
  }

  function renderBody(title, body) {
    if (!body) return `<div class="empty-state">No body captured</div>`;
    let formatted = body;
    try {
      const parsed = JSON.parse(body);
      formatted = JSON.stringify(parsed, null, 2);
    } catch { /* not JSON, display raw */ }
    return `<div class="section-title">${title}</div><pre>${escapeHtml(formatted)}</pre>`;
  }

  function renderTiming(entry) {
    let html = '<div class="section-title">Timing</div>';
    html += headerRow('Started', entry.timestamp ? new Date(entry.timestamp).toISOString() : '-');
    html += headerRow('Duration', entry.duration != null ? entry.duration + ' ms' : 'Pending');
    html += headerRow('Tab ID', entry.tabId != null ? String(entry.tabId) : '-');
    return html;
  }

  function headerRow(name, value) {
    return `<div class="header-row"><span class="header-name">${escapeHtml(name)}:</span><span class="header-value">${escapeHtml(String(value || ''))}</span></div>`;
  }

  // --- Copy as cURL ---

  document.getElementById('btn-copy-curl').addEventListener('click', () => {
    const entry = entries.find(e => e.id === selectedId);
    if (!entry) return;

    let curl = `curl '${entry.url}'`;
    if (entry.method !== 'GET') {
      curl += ` -X ${entry.method}`;
    }
    if (entry.requestHeaders) {
      for (const [k, v] of Object.entries(entry.requestHeaders)) {
        curl += ` -H '${k}: ${v}'`;
      }
    }
    if (entry.requestBody) {
      curl += ` --data-raw '${entry.requestBody.replace(/'/g, "'\\''")}'`;
    }
    navigator.clipboard.writeText(curl);
  });

  // --- Clear ---

  document.getElementById('btn-clear').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_ENTRIES' });
    entries = [];
    selectedId = null;
    detailPane.style.display = 'none';
    render();
  });

  // --- Export HAR ---

  document.getElementById('btn-export-har').addEventListener('click', () => {
    const har = buildHar(getFiltered());
    downloadJson(har, 'network-log.har');
  });

  function buildHar(list) {
    return {
      log: {
        version: '1.2',
        creator: { name: 'NetRecall', version: '1.0.0' },
        entries: list.map(e => ({
          startedDateTime: new Date(e.timestamp).toISOString(),
          time: e.duration || 0,
          request: {
            method: e.method || 'GET',
            url: e.url,
            httpVersion: 'HTTP/1.1',
            headers: objToHarHeaders(e.requestHeaders),
            queryString: parseQueryString(e.url),
            postData: e.requestBody ? { mimeType: 'application/octet-stream', text: e.requestBody } : undefined,
            headersSize: -1,
            bodySize: e.requestBody ? e.requestBody.length : 0,
          },
          response: {
            status: e.statusCode || 0,
            statusText: e.statusText || '',
            httpVersion: 'HTTP/1.1',
            headers: objToHarHeaders(e.responseHeaders),
            content: {
              size: e.size || 0,
              mimeType: e.responseHeaders?.['content-type'] || 'application/octet-stream',
              text: e.responseBody || '',
            },
            headersSize: -1,
            bodySize: e.size || 0,
          },
          cache: {},
          timings: { send: 0, wait: e.duration || 0, receive: 0 },
        })),
      },
    };
  }

  function objToHarHeaders(obj) {
    if (!obj) return [];
    return Object.entries(obj).map(([name, value]) => ({ name, value }));
  }

  function parseQueryString(url) {
    try {
      const u = new URL(url);
      return Array.from(u.searchParams.entries()).map(([name, value]) => ({ name, value }));
    } catch {
      return [];
    }
  }

  // --- Export JSON ---

  document.getElementById('btn-export-json').addEventListener('click', () => {
    downloadJson(getFiltered(), 'network-log.json');
  });

  function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- Helpers ---

  function getStatusClass(code) {
    if (code === null || code === undefined) return '';
    if (code === 0) return 'status-err';
    if (code >= 200 && code < 300) return 'status-2xx';
    if (code >= 300 && code < 400) return 'status-3xx';
    if (code >= 400 && code < 500) return 'status-4xx';
    if (code >= 500) return 'status-5xx';
    return '';
  }

  function getDisplayUrl(url) {
    try {
      const u = new URL(url);
      return u.pathname + u.search;
    } catch {
      return url;
    }
  }

  function formatSize(bytes) {
    if (bytes == null) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
