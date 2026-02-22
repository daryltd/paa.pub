/**
 * HTTP Signatures (draft-cavage-http-signatures-12).
 *
 * Used by ActivityPub for server-to-server authentication. When this
 * server sends an activity to a remote inbox, it signs the request with
 * its RSA private key. When receiving activities, it verifies the
 * sender's signature using their public key (fetched from their actor document).
 *
 * Signature format: `Signature` header containing:
 *   - keyId: URI pointing to the signer's public key (e.g., actor#main-key)
 *   - algorithm: "rsa-sha256"
 *   - headers: space-separated list of signed headers
 *   - signature: base64-encoded RSA-SHA256 signature of the signing string
 *
 * The signing string is constructed by concatenating the specified headers
 * in `headerName: headerValue` format, joined by newlines. The special
 * `(request-target)` pseudo-header includes the HTTP method and path.
 */
import { importPrivateKey, importPublicKey, rsaSign, rsaVerify } from '../crypto/rsa.js';
import { digestHeader } from '../crypto/digest.js';

/**
 * Sign an outgoing request.
 * @param {object} opts
 * @param {string} opts.keyId - Key ID URI (e.g., actor#main-key)
 * @param {string} opts.privatePem - PKCS#8 private key PEM
 * @param {string} opts.method - HTTP method
 * @param {string} opts.url - Target URL
 * @param {string} opts.body - Request body
 * @returns {Promise<object>} Headers to add to the request
 */
export async function signRequest({ keyId, privatePem, method, url, body }) {
  const parsed = new URL(url);
  const target = parsed.pathname;
  const host = parsed.host;
  const date = new Date().toUTCString();
  const digest = await digestHeader(body || '');

  const headers = ['(request-target)', 'host', 'date', 'digest'];
  const sigString = [
    `(request-target): ${method.toLowerCase()} ${target}`,
    `host: ${host}`,
    `date: ${date}`,
    `digest: ${digest}`,
  ].join('\n');

  const key = await importPrivateKey(privatePem);
  const sigBytes = await rsaSign(key, new TextEncoder().encode(sigString));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));

  return {
    Host: host,
    Date: date,
    Digest: digest,
    Signature: `keyId="${keyId}",algorithm="rsa-sha256",headers="${headers.join(' ')}",signature="${signature}"`,
  };
}

/**
 * Verify an incoming request's HTTP Signature.
 * @param {Request} request
 * @param {string} publicPem - SPKI public key PEM
 * @returns {Promise<boolean>}
 */
export async function verifyRequestSignature(request, publicPem) {
  const sigHeader = request.headers.get('Signature');
  if (!sigHeader) return false;

  const params = parseSignatureHeader(sigHeader);
  if (!params || !params.signature || !params.headers) return false;

  const url = new URL(request.url);
  const headerNames = params.headers.split(' ');

  // Check Date header staleness (5 minute window) if date is a signed header
  if (headerNames.includes('date')) {
    const dateValue = request.headers.get('date');
    if (dateValue) {
      const requestDate = new Date(dateValue);
      if (isNaN(requestDate.getTime())) return false;
      const age = Math.abs(Date.now() - requestDate.getTime());
      if (age > 5 * 60 * 1000) {
        console.log(`[httpsig] rejected: Date header too old (${age}ms)`);
        return false;
      }
    }
  }

  const sigStringParts = [];
  for (const name of headerNames) {
    if (name === '(request-target)') {
      sigStringParts.push(`(request-target): ${request.method.toLowerCase()} ${url.pathname}`);
    } else {
      const value = request.headers.get(name);
      if (value === null) return false;
      sigStringParts.push(`${name}: ${value}`);
    }
  }
  const sigString = sigStringParts.join('\n');

  try {
    const key = await importPublicKey(publicPem);
    const sigBytes = Uint8Array.from(atob(params.signature), c => c.charCodeAt(0));
    return await rsaVerify(key, sigBytes, new TextEncoder().encode(sigString));
  } catch {
    return false;
  }
}

/**
 * Extract keyId from a Signature header.
 * @param {string} sigHeader
 * @returns {string|null}
 */
export function extractKeyId(sigHeader) {
  const params = parseSignatureHeader(sigHeader);
  return params?.keyId || null;
}

function parseSignatureHeader(header) {
  const params = {};
  const regex = /(\w+)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(header)) !== null) {
    params[match[1]] = match[2];
  }
  return params;
}
