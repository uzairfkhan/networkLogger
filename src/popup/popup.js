/**
 * Popup settings logic.
 */

(function () {
  'use strict';

  const btnToggle = document.getElementById('btn-toggle');
  const btnClear = document.getElementById('btn-clear');
  const filterMode = document.getElementById('filter-mode');
  const domainSection = document.getElementById('domain-section');
  const domainInput = document.getElementById('domain-input');
  const btnAddDomain = document.getElementById('btn-add-domain');
  const domainListEl = document.getElementById('domain-list');
  const bufferMinutes = document.getElementById('buffer-minutes');
  const maxBodySize = document.getElementById('max-body-size');
  const statsText = document.getElementById('stats-text');

  let settings = {};

  // --- Load settings ---

  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
    if (!response?.settings) return;
    settings = response.settings;

    filterMode.value = settings.filterMode || 'off';
    bufferMinutes.value = settings.bufferMinutes || 20;
    maxBodySize.value = settings.maxBodySizeKB || 100;
    updatePauseButton(settings.paused);
    updateDomainVisibility();
    renderDomainList();
  });

  // --- Load stats ---

  function loadStats() {
    chrome.runtime.sendMessage({ type: 'GET_STATS' }, (response) => {
      if (!response?.stats) return;
      const s = response.stats;
      const age = s.oldestTimestamp
        ? Math.round((Date.now() - s.oldestTimestamp) / 60000) + ' min ago'
        : '-';
      statsText.textContent = `${s.totalEntries} requests (${s.entriesWithBody} with body) | ${s.estimatedSizeKB} KB | oldest: ${age}`;
    });
  }

  loadStats();

  // --- Pause / Resume ---

  btnToggle.addEventListener('click', () => {
    const isPaused = settings.paused;
    const type = isPaused ? 'RESUME' : 'PAUSE';
    chrome.runtime.sendMessage({ type }, () => {
      settings.paused = !isPaused;
      updatePauseButton(settings.paused);
    });
  });

  function updatePauseButton(paused) {
    if (paused) {
      btnToggle.textContent = 'Resume';
      btnToggle.classList.add('paused');
    } else {
      btnToggle.textContent = 'Pause';
      btnToggle.classList.remove('paused');
    }
  }

  // --- Clear ---

  btnClear.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_ENTRIES' }, () => {
      loadStats();
    });
  });

  // --- Filter mode ---

  filterMode.addEventListener('change', () => {
    settings.filterMode = filterMode.value;
    updateDomainVisibility();
    saveSettings();
  });

  function updateDomainVisibility() {
    domainSection.style.display = settings.filterMode === 'off' ? 'none' : 'block';
  }

  // --- Domain management ---

  btnAddDomain.addEventListener('click', addDomain);
  domainInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addDomain();
  });

  function addDomain() {
    const domain = domainInput.value.trim().toLowerCase();
    if (!domain) return;
    if (!settings.domainList) settings.domainList = [];
    if (settings.domainList.includes(domain)) return;
    settings.domainList.push(domain);
    domainInput.value = '';
    renderDomainList();
    saveSettings();
  }

  function removeDomain(domain) {
    settings.domainList = (settings.domainList || []).filter(d => d !== domain);
    renderDomainList();
    saveSettings();
  }

  function renderDomainList() {
    const domains = settings.domainList || [];
    domainListEl.innerHTML = domains.map(d =>
      `<li><span>${d}</span><button data-domain="${d}">&times;</button></li>`
    ).join('');

    domainListEl.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => removeDomain(btn.dataset.domain));
    });
  }

  // --- Buffer / Body size ---

  bufferMinutes.addEventListener('change', () => {
    settings.bufferMinutes = parseInt(bufferMinutes.value) || 20;
    saveSettings();
  });

  maxBodySize.addEventListener('change', () => {
    settings.maxBodySizeKB = parseInt(maxBodySize.value) || 100;
    saveSettings();
  });

  // --- Save ---

  function saveSettings() {
    chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings }, () => {
      loadStats();
    });
  }
})();
