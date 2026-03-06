/**
 * Locale-aware formatting utilities.
 *
 * Uses the V8 Intl API (available in Cloudflare Workers) for
 * locale-sensitive date, number, and byte formatting.
 *
 * Replaces the duplicated formatBytes() implementations in
 * dashboard.js, storage.js, and acl-editor.js.
 */

/**
 * Format an ISO date string as a locale-aware date (no time).
 * @param {string} isoString - ISO 8601 date string
 * @param {string} locale - BCP 47 locale tag
 * @param {string} [style='medium'] - 'short' | 'medium' | 'long'
 * @returns {string}
 */
export function formatDate(isoString, locale, style = 'medium') {
  if (!isoString) return '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: style }).format(new Date(isoString));
  } catch {
    return new Date(isoString).toLocaleDateString();
  }
}

/**
 * Format an ISO date string as a locale-aware date + time.
 * @param {string} isoString - ISO 8601 date string
 * @param {string} locale - BCP 47 locale tag
 * @param {string} [dateStyle='medium'] - 'short' | 'medium' | 'long'
 * @returns {string}
 */
export function formatDateTime(isoString, locale, dateStyle = 'medium') {
  if (!isoString) return '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle, timeStyle: 'short' }).format(new Date(isoString));
  } catch {
    return new Date(isoString).toLocaleString();
  }
}

/**
 * Format a number with locale-aware grouping separators.
 * @param {number} num
 * @param {string} locale
 * @returns {string}
 */
export function formatNumber(num, locale) {
  try {
    return new Intl.NumberFormat(locale).format(num);
  } catch {
    return String(num);
  }
}

/**
 * Format a byte count as a human-readable string (e.g. "1.5 GB").
 * @param {number} bytes
 * @param {string} [locale='en-US']
 * @returns {string}
 */
export function formatBytes(bytes, locale = 'en-US') {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  try {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${sizes[i]}`;
  } catch {
    return `${value.toFixed(1)} ${sizes[i]}`;
  }
}

/**
 * Format a byte count in compact form (e.g. "1GB", "500MB").
 * Used for form input values where brevity matters.
 * @param {number} bytes
 * @param {string} [locale='en-US']
 * @returns {string}
 */
export function formatBytesShort(bytes, locale = 'en-US') {
  if (!bytes || bytes === 0) return '';
  const k = 1024;
  if (bytes >= k * k * k) return `${Math.round(bytes / (k * k * k))}GB`;
  if (bytes >= k * k) return `${Math.round(bytes / (k * k))}MB`;
  if (bytes >= k) return `${Math.round(bytes / k)}KB`;
  return `${bytes}B`;
}
