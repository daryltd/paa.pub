/**
 * Shared utility functions.
 */

/**
 * Simple string hash (DJB2-like). Returns a base-36 string.
 * @param {string} str
 * @returns {string}
 */
export function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Convert an ArrayBuffer to a base64url string.
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {string}
 */
export function bufferToBase64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
