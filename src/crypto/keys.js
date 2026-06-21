/**
 * Shared key conversion utilities.
 *
 * PEM-to-JWK conversion used by OIDC token handling and DID document generation.
 */

/**
 * Convert a PEM-encoded SPKI public key to JWK format.
 * @param {string} pem - PEM-encoded public key
 * @returns {Promise<JsonWebKey>}
 */
export async function pemToJwk(pem) {
  const der = pemToDer(pem);
  const key = await crypto.subtle.importKey(
    'spki', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    true, ['verify'],
  );
  return crypto.subtle.exportKey('jwk', key);
}

/**
 * Decode a PEM string to an ArrayBuffer (DER).
 * @param {string} pem
 * @returns {ArrayBuffer}
 */
export function pemToDer(pem) {
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
