/**
 * PBKDF2 password hashing via Web Crypto API.
 */

const ITERATIONS = 100000;
const HASH = 'SHA-256';
const KEY_LENGTH = 32;

/**
 * Hash a password with PBKDF2.
 * @param {string} password
 * @returns {Promise<string>} JSON string with salt + hash (both base64)
 */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: HASH },
    keyMaterial,
    KEY_LENGTH * 8,
  );
  return JSON.stringify({
    salt: bufToBase64(salt),
    hash: bufToBase64(new Uint8Array(bits)),
    iterations: ITERATIONS,
  });
}

/**
 * Verify a password against a stored hash.
 * @param {string} password
 * @param {string} stored - JSON from hashPassword()
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, stored) {
  const { salt, hash, iterations } = JSON.parse(stored);
  const saltBuf = base64ToBuf(salt);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBuf, iterations: iterations || ITERATIONS, hash: HASH },
    keyMaterial,
    KEY_LENGTH * 8,
  );
  const derived = bufToBase64(new Uint8Array(bits));
  return timingSafeEqual(derived, hash);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function bufToBase64(buf) {
  let binary = '';
  for (const byte of buf) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBuf(b64) {
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf;
}
