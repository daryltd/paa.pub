/**
 * WebAuthn passkey registration and authentication.
 *
 * Enables passwordless login using platform authenticators (Touch ID, Windows
 * Hello, security keys). The flow has two phases:
 *
 * Registration (authenticated user adds a passkey):
 *   1. POST /webauthn/register/begin → server generates a challenge, stores in KV
 *   2. Browser calls navigator.credentials.create() with the challenge
 *   3. POST /webauthn/register/complete → server verifies the attestation:
 *      - Decodes clientDataJSON, checks challenge matches
 *      - Decodes attestationObject (CBOR) to extract authenticator data
 *      - Extracts the COSE public key from the credential
 *      - Converts COSE key to JWK format for storage
 *      - Stores credential in APPDATA KV
 *
 * Authentication (any user logs in with a passkey):
 *   1. POST /webauthn/login/begin → server generates a challenge, lists allowed credentials
 *   2. Browser calls navigator.credentials.get() with the challenge
 *   3. POST /webauthn/login/complete → server verifies the assertion:
 *      - Checks challenge, origin, and rpIdHash
 *      - Imports stored JWK public key
 *      - Verifies the signature over authenticatorData + clientDataHash
 *      - Creates a session on success
 *
 * Credential storage in APPDATA KV:
 *   - `webauthn_creds:{username}` → JSON array of credential IDs
 *   - `webauthn_cred:{username}:{credId}` → JSON with name, publicKey (JWK), createdAt
 *   - `webauthn_challenge:{challenge}` → temporary challenge data (60s TTL)
 */
import { decodeCBOR } from '../crypto/cbor.js';
import { createSession } from './session.js';
import { bufferToBase64url } from '../utils.js';

const CHALLENGE_TTL = 60; // seconds

/**
 * POST /webauthn/register/begin
 * Begin passkey registration. Requires active session.
 */
export async function handleWebAuthnRegisterBegin(reqCtx) {
  const { config, env, user } = reqCtx;
  if (!user) return new Response('Unauthorized', { status: 401 });

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const challengeB64 = bufferToBase64url(challenge);

  // Store challenge
  await env.APPDATA.put(`webauthn_challenge:${challengeB64}`, JSON.stringify({
    username: user,
    type: 'registration',
  }), { expirationTtl: CHALLENGE_TTL });

  const options = {
    challenge: challengeB64,
    rp: {
      name: 'paa.pub',
      id: config.domain.split(':')[0], // hostname only
    },
    user: {
      id: bufferToBase64url(new TextEncoder().encode(user)),
      name: user,
      displayName: user,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },   // ES256
      { type: 'public-key', alg: -257 },  // RS256
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    timeout: 60000,
    attestation: 'none',
  };

  // Include existing credentials to avoid re-registration
  const existingCreds = await env.APPDATA.get(`webauthn_creds:${user}`);
  if (existingCreds) {
    const credIds = JSON.parse(existingCreds);
    options.excludeCredentials = credIds.map(id => ({
      type: 'public-key',
      id,
    }));
  }

  return new Response(JSON.stringify(options), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /webauthn/register/complete
 * Complete passkey registration.
 */
export async function handleWebAuthnRegisterComplete(reqCtx) {
  const { request, env, user, config } = reqCtx;
  if (!user) return new Response('Unauthorized', { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const { id, rawId, response: credResponse, type } = body;

  if (type !== 'public-key') {
    return new Response('Invalid credential type', { status: 400 });
  }

  // Decode clientDataJSON
  const clientDataJSON = base64urlToBuffer(credResponse.clientDataJSON);
  const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));

  // Verify challenge
  const challengeData = await env.APPDATA.get(`webauthn_challenge:${clientData.challenge}`);
  if (!challengeData) {
    return new Response('Invalid or expired challenge', { status: 400 });
  }
  const challengeInfo = JSON.parse(challengeData);
  if (challengeInfo.username !== user || challengeInfo.type !== 'registration') {
    return new Response('Challenge mismatch', { status: 400 });
  }

  // Delete used challenge
  await env.APPDATA.delete(`webauthn_challenge:${clientData.challenge}`);

  // Verify origin
  const expectedOrigin = `${config.protocol}://${config.domain}`;
  if (clientData.origin !== expectedOrigin) {
    return new Response('Origin mismatch', { status: 400 });
  }

  // Decode attestationObject
  const attestationObject = base64urlToBuffer(credResponse.attestationObject);
  const attestation = decodeCBOR(attestationObject);
  const authData = attestation.authData;

  // Parse authenticator data
  const parsed = parseAuthenticatorData(authData);
  if (!parsed.attestedCredentialData) {
    return new Response('No attested credential data', { status: 400 });
  }

  // Extract public key
  const credentialPublicKey = parsed.attestedCredentialData.publicKey;
  const publicKeyJwk = await coseToJwk(credentialPublicKey);

  // Store credential
  await env.APPDATA.put(`webauthn_cred:${user}:${id}`, JSON.stringify({
    publicKeyJwk,
    signCount: parsed.signCount,
    name: `Passkey ${new Date().toISOString().slice(0, 10)}`,
    createdAt: new Date().toISOString(),
  }));

  // Update credential list
  const existingCreds = await env.APPDATA.get(`webauthn_creds:${user}`);
  const credIds = existingCreds ? JSON.parse(existingCreds) : [];
  credIds.push(id);
  await env.APPDATA.put(`webauthn_creds:${user}`, JSON.stringify(credIds));

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /webauthn/login/begin
 * Begin passkey authentication.
 */
export async function handleWebAuthnLoginBegin(reqCtx) {
  const { config, env } = reqCtx;
  const username = config.username;

  // Get registered credentials
  const existingCreds = await env.APPDATA.get(`webauthn_creds:${username}`);
  if (!existingCreds) {
    return new Response('No passkeys registered', { status: 404 });
  }
  const credIds = JSON.parse(existingCreds);
  if (credIds.length === 0) {
    return new Response('No passkeys registered', { status: 404 });
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const challengeB64 = bufferToBase64url(challenge);

  await env.APPDATA.put(`webauthn_challenge:${challengeB64}`, JSON.stringify({
    username,
    type: 'authentication',
  }), { expirationTtl: CHALLENGE_TTL });

  const options = {
    challenge: challengeB64,
    rpId: config.domain.split(':')[0],
    allowCredentials: credIds.map(id => ({
      type: 'public-key',
      id,
    })),
    userVerification: 'preferred',
    timeout: 60000,
  };

  return new Response(JSON.stringify(options), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /webauthn/login/complete
 * Complete passkey authentication.
 */
export async function handleWebAuthnLoginComplete(reqCtx) {
  const { request, env, config } = reqCtx;
  const username = config.username;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const { id, rawId, response: credResponse, type } = body;

  if (type !== 'public-key') {
    return new Response('Invalid credential type', { status: 400 });
  }

  // Decode clientDataJSON
  const clientDataJSON = base64urlToBuffer(credResponse.clientDataJSON);
  const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));

  // Verify challenge
  const challengeData = await env.APPDATA.get(`webauthn_challenge:${clientData.challenge}`);
  if (!challengeData) {
    return new Response('Invalid or expired challenge', { status: 400 });
  }
  const challengeInfo = JSON.parse(challengeData);
  if (challengeInfo.username !== username || challengeInfo.type !== 'authentication') {
    return new Response('Challenge mismatch', { status: 400 });
  }
  await env.APPDATA.delete(`webauthn_challenge:${clientData.challenge}`);

  // Verify origin
  const expectedOrigin = `${config.protocol}://${config.domain}`;
  if (clientData.origin !== expectedOrigin) {
    return new Response('Origin mismatch', { status: 400 });
  }

  // Get stored credential
  const credData = await env.APPDATA.get(`webauthn_cred:${username}:${id}`);
  if (!credData) {
    return new Response('Unknown credential', { status: 400 });
  }
  const cred = JSON.parse(credData);

  // Parse authenticator data
  const authenticatorData = base64urlToBuffer(credResponse.authenticatorData);
  const authData = parseAuthenticatorData(new Uint8Array(authenticatorData));

  // Verify signature
  const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSON);
  const signedData = new Uint8Array(authenticatorData.byteLength + clientDataHash.byteLength);
  signedData.set(new Uint8Array(authenticatorData), 0);
  signedData.set(new Uint8Array(clientDataHash), authenticatorData.byteLength);

  let signature = base64urlToBuffer(credResponse.signature);

  const isEC = cred.publicKeyJwk.kty === 'EC';

  // WebAuthn returns ECDSA signatures in DER/ASN.1 format,
  // but Web Crypto expects raw r||s format
  if (isEC) {
    signature = derToRaw(new Uint8Array(signature), cred.publicKeyJwk.crv);
  }

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    cred.publicKeyJwk,
    isEC
      ? { name: 'ECDSA', namedCurve: cred.publicKeyJwk.crv }
      : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const algo = isEC
    ? { name: 'ECDSA', hash: 'SHA-256' }
    : 'RSASSA-PKCS1-v1_5';

  const valid = await crypto.subtle.verify(algo, publicKey, signature, signedData);
  if (!valid) {
    return new Response('Invalid signature', { status: 401 });
  }

  // Update sign count
  cred.signCount = authData.signCount;
  await env.APPDATA.put(`webauthn_cred:${username}:${id}`, JSON.stringify(cred));

  // Create session
  const token = await createSession(env.APPDATA, username);

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${config.protocol === 'https' ? '; Secure' : ''}`,
    },
  });
}

/**
 * POST /webauthn/rename
 * Rename a passkey.
 */
export async function handleWebAuthnRename(reqCtx) {
  const { request, env, user } = reqCtx;
  if (!user) return new Response('Unauthorized', { status: 401 });

  const form = await request.formData();
  const credId = form.get('credId');
  const name = form.get('name');
  if (!credId || !name) return new Response('Missing fields', { status: 400 });

  const key = `webauthn_cred:${user}:${credId}`;
  const data = await env.APPDATA.get(key);
  if (!data) return new Response('Credential not found', { status: 404 });

  const cred = JSON.parse(data);
  cred.name = name;
  await env.APPDATA.put(key, JSON.stringify(cred));

  return new Response(null, { status: 302, headers: { 'Location': '/dashboard' } });
}

/**
 * POST /webauthn/delete
 * Delete a passkey.
 */
export async function handleWebAuthnDelete(reqCtx) {
  const { request, env, user } = reqCtx;
  if (!user) return new Response('Unauthorized', { status: 401 });

  const form = await request.formData();
  const credId = form.get('credId');
  if (!credId) return new Response('Missing credId', { status: 400 });

  // Delete credential data
  await env.APPDATA.delete(`webauthn_cred:${user}:${credId}`);

  // Remove from credential list
  const listKey = `webauthn_creds:${user}`;
  const existing = await env.APPDATA.get(listKey);
  if (existing) {
    const credIds = JSON.parse(existing).filter(id => id !== credId);
    await env.APPDATA.put(listKey, JSON.stringify(credIds));
  }

  return new Response(null, { status: 302, headers: { 'Location': '/dashboard' } });
}

// --- Helpers ---

function parseAuthenticatorData(data) {
  const rpIdHash = data.slice(0, 32);
  const flags = data[32];
  const signCount = (data[33] << 24) | (data[34] << 16) | (data[35] << 8) | data[36];
  let offset = 37;

  const result = { rpIdHash, flags, signCount };

  // Attested credential data (if flag bit 6 is set)
  if (flags & 0x40) {
    const aaguid = data.slice(offset, offset + 16);
    offset += 16;
    const credIdLength = (data[offset] << 8) | data[offset + 1];
    offset += 2;
    const credentialId = data.slice(offset, offset + credIdLength);
    offset += credIdLength;

    // CBOR-encoded public key
    const remaining = data.slice(offset);
    const publicKey = decodeCBOR(remaining.buffer.slice(remaining.byteOffset));

    result.attestedCredentialData = {
      aaguid,
      credentialId,
      publicKey,
    };
  }

  return result;
}

async function coseToJwk(coseKey) {
  const kty = coseKey[1]; // 1 = key type
  const alg = coseKey[3]; // 3 = algorithm

  if (kty === 2) {
    // EC2 key
    const crv = coseKey[-1];
    const x = coseKey[-2];
    const y = coseKey[-3];
    return {
      kty: 'EC',
      crv: crv === 1 ? 'P-256' : crv === 2 ? 'P-384' : 'P-521',
      x: bufferToBase64url(x),
      y: bufferToBase64url(y),
    };
  }

  if (kty === 3) {
    // RSA key
    const n = coseKey[-1];
    const e = coseKey[-2];
    return {
      kty: 'RSA',
      n: bufferToBase64url(n),
      e: bufferToBase64url(e),
    };
  }

  throw new Error(`Unsupported COSE key type: ${kty}`);
}

function base64urlToBuffer(b64) {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Convert a DER-encoded ECDSA signature to raw r||s format.
 * WebAuthn returns DER, Web Crypto expects raw.
 * @param {Uint8Array} der
 * @param {string} crv - curve name (P-256 → 32 bytes, P-384 → 48, P-521 → 66)
 * @returns {ArrayBuffer}
 */
function derToRaw(der, crv) {
  const componentLength = crv === 'P-256' ? 32 : crv === 'P-384' ? 48 : 66;

  // DER: 0x30 <len> 0x02 <rLen> <r> 0x02 <sLen> <s>
  let offset = 2; // skip SEQUENCE tag and length
  if (der[1] & 0x80) offset += (der[1] & 0x7f); // long form length

  // Read r
  if (der[offset] !== 0x02) throw new Error('Expected INTEGER tag for r');
  offset++;
  const rLen = der[offset++];
  let r = der.slice(offset, offset + rLen);
  offset += rLen;

  // Read s
  if (der[offset] !== 0x02) throw new Error('Expected INTEGER tag for s');
  offset++;
  const sLen = der[offset++];
  let s = der.slice(offset, offset + sLen);

  // Strip leading zero padding (DER uses signed integers)
  if (r.length > componentLength) r = r.slice(r.length - componentLength);
  if (s.length > componentLength) s = s.slice(s.length - componentLength);

  // Pad to fixed length
  const raw = new Uint8Array(componentLength * 2);
  raw.set(r, componentLength - r.length);
  raw.set(s, componentLength * 2 - s.length);
  return raw.buffer;
}
