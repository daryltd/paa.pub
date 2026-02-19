/**
 * HTTP Signature sign/verify (draft-cavage).
 *
 * Ported from paa/src/lib/src/activity/httpsig.rs
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
