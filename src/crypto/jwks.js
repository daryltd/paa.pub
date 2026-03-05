/**
 * JWKS-based JWT verification via Web Crypto.
 *
 * Verifies JWTs from arbitrary identity providers by fetching their
 * published JWKS and validating signatures directly with Web Crypto's
 * JWK import — no PEM conversion needed.
 */

/**
 * Map JWT algorithm strings to Web Crypto import/verify parameters.
 */
const ALG_PARAMS = {
  RS256: {
    import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    verify: { name: 'RSASSA-PKCS1-v1_5' },
  },
  RS384: {
    import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' },
    verify: { name: 'RSASSA-PKCS1-v1_5' },
  },
  RS512: {
    import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' },
    verify: { name: 'RSASSA-PKCS1-v1_5' },
  },
  ES256: {
    import: { name: 'ECDSA', namedCurve: 'P-256' },
    verify: { name: 'ECDSA', hash: 'SHA-256' },
  },
  ES384: {
    import: { name: 'ECDSA', namedCurve: 'P-384' },
    verify: { name: 'ECDSA', hash: 'SHA-384' },
  },
};

/**
 * Decode a base64url string to a Uint8Array.
 */
function base64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Verify a JWT against a JWKS endpoint.
 *
 * @param {string} token - The raw JWT string (header.payload.signature)
 * @param {string} jwksUrl - URL to the JWKS endpoint
 * @param {string} expectedAud - Expected audience (client_id)
 * @param {string} expectedIss - Expected issuer
 * @returns {Promise<object>} Decoded JWT payload
 * @throws {Error} If verification fails for any reason
 */
export async function verifyJwtWithJwks(token, jwksUrl, expectedAud, expectedIss) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [headerB64, payloadB64, sigB64] = parts;

  // Decode header and payload
  const header = JSON.parse(new TextDecoder().decode(base64urlDecode(headerB64)));
  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));

  const alg = header.alg;
  const kid = header.kid;

  if (!alg || !ALG_PARAMS[alg]) {
    throw new Error(`Unsupported algorithm: ${alg}`);
  }

  // Fetch JWKS
  const jwksRes = await fetch(jwksUrl, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!jwksRes.ok) {
    throw new Error(`Failed to fetch JWKS: ${jwksRes.status}`);
  }
  const jwks = await jwksRes.json();

  // Find matching key
  const keys = jwks.keys || [];
  let jwk = kid ? keys.find(k => k.kid === kid) : null;
  if (!jwk) {
    // Fallback: find by alg and key type
    const kty = alg.startsWith('RS') ? 'RSA' : 'EC';
    jwk = keys.find(k => k.kty === kty && (!k.alg || k.alg === alg) && k.use !== 'enc');
  }
  if (!jwk) {
    throw new Error(`No matching JWK found for kid=${kid} alg=${alg}`);
  }

  // Import key
  const params = ALG_PARAMS[alg];
  const cryptoKey = await crypto.subtle.importKey('jwk', jwk, params.import, false, ['verify']);

  // Verify signature
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64urlDecode(sigB64);
  const valid = await crypto.subtle.verify(params.verify, cryptoKey, signature, signingInput);

  if (!valid) {
    throw new Error('Invalid JWT signature');
  }

  // Validate claims
  const now = Math.floor(Date.now() / 1000);

  if (payload.exp && payload.exp < now) {
    throw new Error('Token expired');
  }

  if (payload.iss !== expectedIss) {
    throw new Error(`Issuer mismatch: expected ${expectedIss}, got ${payload.iss}`);
  }

  if (payload.aud !== expectedAud) {
    // aud can be a string or array
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(expectedAud)) {
      throw new Error(`Audience mismatch: expected ${expectedAud}`);
    }
  }

  return payload;
}
