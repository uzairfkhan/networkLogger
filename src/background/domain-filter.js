/**
 * Domain filtering — whitelist/blacklist URL matching.
 */

let filterMode = 'off';
let domainSet = new Set();

/**
 * Update filter configuration.
 * @param {'off'|'whitelist'|'blacklist'} mode
 * @param {string[]} domains
 */
export function setFilter(mode, domains) {
  filterMode = mode;
  domainSet = new Set(domains.map(d => d.toLowerCase().replace(/^www\./, '')));
}

/**
 * Check whether a URL should be logged based on current filter settings.
 * @param {string} url
 * @returns {boolean}
 */
export function shouldLog(url) {
  if (filterMode === 'off') return true;

  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return filterMode !== 'whitelist'; // if URL is invalid, only block in whitelist mode
  }

  const matched = domainMatches(hostname);
  return filterMode === 'whitelist' ? matched : !matched;
}

/**
 * Check if hostname matches any domain in the set (supports subdomain matching).
 */
function domainMatches(hostname) {
  if (domainSet.has(hostname)) return true;
  // Check if hostname is a subdomain of any listed domain
  for (const domain of domainSet) {
    if (hostname.endsWith('.' + domain)) return true;
  }
  return false;
}
