/**
 * RSA-2048 keypair generation and import via Web Crypto.
 * Uses RSASSA-PKCS1-v1_5 with SHA-256 (for HTTP Signatures).
 */

const ALGO = {
  name: 'RSASSA-PKCS1-v1_5',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
};

/**
 * Generate an RSA-2048 keypair.
 * @returns {Promise<{privatePem: string, publicPem: string}>}
 */
export async function generateRSAKeyPair() {
  const keyPair = await crypto.subtle.generateKey(ALGO, true, ['sign', 'verify']);
  const privateDer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const publicDer = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  return {
    privatePem: derToPem(privateDer, 'PRIVATE KEY'),
    publicPem: derToPem(publicDer, 'PUBLIC KEY'),
  };
}

/**
 * Import a private key from PEM for signing.
 * @param {string} pem
 * @returns {Promise<CryptoKey>}
 */
export async function importPrivateKey(pem) {
  const der = pemToDer(pem);
  return crypto.subtle.importKey('pkcs8', der, ALGO, false, ['sign']);
}

/**
 * Import a public key from PEM for verification.
 * @param {string} pem
 * @returns {Promise<CryptoKey>}
 */
export async function importPublicKey(pem) {
  const der = pemToDer(pem);
  return crypto.subtle.importKey('spki', der, ALGO, false, ['verify']);
}

/**
 * Sign data with a private key.
 * @param {CryptoKey} key
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {Promise<ArrayBuffer>}
 */
export async function rsaSign(key, data) {
  return crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data);
}

/**
 * Verify a signature with a public key.
 * @param {CryptoKey} key
 * @param {ArrayBuffer|Uint8Array} signature
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {Promise<boolean>}
 */
export async function rsaVerify(key, signature, data) {
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
}

function derToPem(der, label) {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

function pemToDer(pem) {
  const b64 = pem
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
