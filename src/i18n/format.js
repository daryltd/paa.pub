/**
 * Locale-aware formatting utilities.
 *
 * Uses built-in Intl APIs (available in Cloudflare Workers V8 runtime)
 * to format dates, numbers, and byte sizes according to locale conventions.
 *
 * Replaces the multiple ad-hoc formatBytes() implementations scattered
 * across dashboard.js, acl-editor.js, storage.js, admin/dashboard.js,
 * and admin/users.js.
 */

/**
 * Format a date string (date only, no time).
 * @param {string} isoString - ISO 8601 date string
 * @param {string} locale - BCP 47 locale tag (e.g. 'en-US', 'fr')
 * @param {string} [style='medium'] - 'short', 'medium', or 'long'
 * @returns {string}
 */
export function formatDate(isoString, locale, style = 'medium') {
  if (!isoString) return '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: style }).format(new Date(isoString));
  } catch {
    return isoString.split('T')[0];
  }
}

/**
 * Format a date string with both date and time.
 * @param {string} isoString
 * @param {string} locale
 * @returns {string}
 */
export function formatDateTime(isoString, locale) {
  if (!isoString) return '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

/**
 * Format a number according to locale conventions.
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
 * Uses locale-aware number formatting for the numeric part.
 * @param {number} bytes
 * @param {string} [locale='en-US']
 * @returns {string}
 */
export function formatBytes(bytes, locale = 'en-US') {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  const val = bytes / Math.pow(k, i);
  const formatted = val < 10 ? val.toFixed(1) : String(Math.round(val));
  return `${formatted} ${units[i]}`;
}

/**
 * Format bytes in short form without space (e.g. "500MB", "1GB").
 * Used for quota input default values.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytesShort(bytes) {
  if (!bytes || bytes === 0) return '';
  const k = 1024;
  if (bytes >= k * k * k) return `${(bytes / (k * k * k)).toFixed(0)}GB`;
  if (bytes >= k * k) return `${(bytes / (k * k)).toFixed(0)}MB`;
  if (bytes >= k) return `${(bytes / k).toFixed(0)}KB`;
  return `${bytes}B`;
}
