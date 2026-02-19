/**
 * SHA-256 digest utilities via Web Crypto.
 */

/**
 * Compute SHA-256 digest of a string or buffer.
 * @param {string|ArrayBuffer|Uint8Array} data
 * @returns {Promise<ArrayBuffer>}
 */
export async function sha256(data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return crypto.subtle.digest('SHA-256', buf);
}

/**
 * Compute SHA-256 digest and return as base64.
 * @param {string|ArrayBuffer|Uint8Array} data
 * @returns {Promise<string>}
 */
export async function sha256Base64(data) {
  const hash = await sha256(data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

/**
 * Compute SHA-256 digest header value: "SHA-256=<base64>"
 * @param {string|ArrayBuffer|Uint8Array} data
 * @returns {Promise<string>}
 */
export async function digestHeader(data) {
  const b64 = await sha256Base64(data);
  return `SHA-256=${b64}`;
}
