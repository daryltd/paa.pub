/**
 * WebAuthn passkey registration and authentication flows.
 */
import { decodeCBOR } from '../crypto/cbor.js';
import { createSession } from './session.js';

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

  const body = await request.json();
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

  const body = await request.json();
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

  const signature = base64urlToBuffer(credResponse.signature);

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    cred.publicKeyJwk,
    cred.publicKeyJwk.kty === 'EC'
      ? { name: 'ECDSA', namedCurve: cred.publicKeyJwk.crv }
      : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const algo = cred.publicKeyJwk.kty === 'EC'
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

function bufferToBase64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlToBuffer(b64) {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
