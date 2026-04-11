// Message types
export const MSG = {
  // Content script -> Service worker
  BODY_CAPTURED: 'BODY_CAPTURED',

  // DevTools panel <-> Service worker
  GET_ENTRIES: 'GET_ENTRIES',
  CLEAR_ENTRIES: 'CLEAR_ENTRIES',
  ENTRY_ADDED: 'ENTRY_ADDED',
  ENTRY_UPDATED: 'ENTRY_UPDATED',
  ENTRIES_CLEARED: 'ENTRIES_CLEARED',
  SUBSCRIBE: 'SUBSCRIBE',
  UNSUBSCRIBE: 'UNSUBSCRIBE',

  // Popup <-> Service worker
  GET_SETTINGS: 'GET_SETTINGS',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  GET_STATS: 'GET_STATS',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
};

// Default settings
export const DEFAULTS = {
  filterMode: 'off',       // 'off' | 'whitelist' | 'blacklist'
  domainList: [],
  bufferMinutes: 20,
  maxBodySizeKB: 100,
  paused: false,
};

// Limits
export const LIMITS = {
  SESSION_STORAGE_MAX_BYTES: 10 * 1024 * 1024, // 10 MB
  BODY_EVICTION_MINUTES: 5,   // keep bodies for recent requests
  CLEANUP_INTERVAL_MINUTES: 1,
  MAX_BODY_SIZE_BYTES: 100 * 1024, // 100 KB per body
  WARN_STORAGE_BYTES: 8 * 1024 * 1024, // start evicting bodies at 8 MB
};

// Resource types to skip (don't capture bodies for these)
export const SKIP_BODY_TYPES = new Set([
  'image', 'font', 'stylesheet', 'script', 'media',
]);

// Alarm names
export const ALARMS = {
  CLEANUP: 'networkLogger_cleanup',
};

// Storage keys
export const STORAGE_KEYS = {
  ENTRIES: 'networkLogger_entries',
  SETTINGS: 'networkLogger_settings',
};
