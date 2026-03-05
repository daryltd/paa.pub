/**
 * FedCM (Federated Credential Management) endpoints.
 *
 * Implements both Identity Provider (IdP) and Relying Party (RP) roles:
 *
 * IdP endpoints (served to browsers / third-party RPs):
 *   GET  /.well-known/web-identity   — well-known provider discovery
 *   GET  /fedcm/config.json          — FedCM IdP manifest
 *   GET  /fedcm/accounts             — authenticated user's account list
 *   POST /fedcm/assertion            — issue signed JWT for RP
 *   GET  /fedcm/client-metadata      — fetch RP metadata (privacy policy, TOS)
 *   POST /fedcm/disconnect           — revoke RP connection
 *
 * RP endpoint (used by our own login pages):
 *   POST /fedcm/verify               — verify JWT from FedCM flow, create session
 */
import { signJwt } from './oidc.js';
import { importPublicKey, rsaVerify } from './crypto/rsa.js';
import { bufferToBase64url } from './utils.js';
import { createSession } from './auth/session.js';
import { parseNTriples, unwrapIri, unwrapLiteral } from './rdf/ntriples.js';
import { PREFIXES } from './rdf/prefixes.js';
import { getUserConfig } from './config.js';
import { userExists, getUser } from './users.js';
import { validateExternalUrl } from './security/ssrf.js';
import { verifyJwtWithJwks } from './crypto/jwks.js';

// ── Internal helpers ─────────────────────────────────

/**
 * Check that the request includes the Sec-Fetch-Dest: webidentity header.
 * Required by the FedCM spec for accounts/assertion/disconnect endpoints.
 */
function requireFedCMHeader(request) {
  return request.headers.get('Sec-Fetch-Dest') === 'webidentity';
}

/**
 * Load profile data (name, email, picture) from the user's WebID profile.
 */
async function loadProfileData(storage, config, username) {
  const webId = `${config.baseUrl}/${username}/profile/card#me`;
  const docUri = `${config.baseUrl}/${username}/profile/card`;
  const ntData = await storage.get(`doc:${docUri}:${webId}`);
  if (!ntData) return { name: username, email: '', picture: '' };

  const triples = parseNTriples(ntData);
  let name = username;
  let email = '';
  let picture = '';

  for (const t of triples) {
    const pred = unwrapIri(t.predicate);
    if (pred === PREFIXES.foaf + 'name') {
      name = unwrapLiteral(t.object);
    } else if (pred === PREFIXES.foaf + 'mbox') {
      const mbox = unwrapIri(t.object);
      email = mbox.startsWith('mailto:') ? mbox.slice(7) : mbox;
    } else if (pred === PREFIXES.foaf + 'img') {
      picture = unwrapIri(t.object);
    }
  }

  return { name, email, picture };
}

/**
 * Read the list of connected RP client_ids for a user.
 */
async function getConnectedClients(kv, username) {
  const data = await kv.get(`fedcm_connected:${username}`);
  return data ? JSON.parse(data) : [];
}

/**
 * Write the list of connected RP client_ids for a user.
 */
async function setConnectedClients(kv, username, clients) {
  await kv.put(`fedcm_connected:${username}`, JSON.stringify(clients));
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ── IdP Handlers ─────────────────────────────────────

/**
 * GET /.well-known/web-identity
 * Returns the FedCM provider URL for browser discovery.
 */
export function handleWebIdentity(reqCtx) {
  const { config } = reqCtx;
  return jsonResponse({
    provider_urls: [`${config.baseUrl}/fedcm/config.json`],
  });
}

/**
 * GET /fedcm/config.json
 * Returns the FedCM IdP manifest describing all endpoints.
 */
export function handleFedCMConfig(reqCtx) {
  const { config } = reqCtx;
  return jsonResponse({
    accounts_endpoint: `${config.baseUrl}/fedcm/accounts`,
    client_metadata_endpoint: `${config.baseUrl}/fedcm/client-metadata`,
    id_assertion_endpoint: `${config.baseUrl}/fedcm/assertion`,
    disconnect_endpoint: `${config.baseUrl}/fedcm/disconnect`,
    login_url: `${config.baseUrl}/login?fedcm=1`,
    branding: {
      background_color: '#1a1a2e',
      color: '#e0e0e0',
    },
  });
}

/**
 * GET /fedcm/accounts
 * Returns the authenticated user's account info for the browser account picker.
 * Requires session cookie + Sec-Fetch-Dest: webidentity header.
 */
export async function handleFedCMAccounts(reqCtx) {
  const { request, config, user, env, storage } = reqCtx;

  if (!requireFedCMHeader(request)) {
    return jsonResponse({ error: 'Missing Sec-Fetch-Dest: webidentity header' }, 403);
  }

  if (!user) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }

  const profile = await loadProfileData(storage, config, user);
  const uc = getUserConfig(config, user);
  const connectedClients = await getConnectedClients(env.APPDATA, user);

  return jsonResponse({
    accounts: [{
      id: user,
      name: profile.name,
      email: profile.email,
      picture: profile.picture,
      approved_clients: connectedClients,
    }],
  });
}

/**
 * POST /fedcm/assertion
 * Issues a signed JWT token for the requesting RP.
 * Requires session cookie + Sec-Fetch-Dest: webidentity header.
 */
export async function handleFedCMAssertion(reqCtx) {
  const { request, config, user, env } = reqCtx;

  if (!requireFedCMHeader(request)) {
    return jsonResponse({ error: 'Missing Sec-Fetch-Dest: webidentity header' }, 403);
  }

  if (!user) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }

  const form = await request.formData();
  const accountId = form.get('account_id') || '';
  const clientId = form.get('client_id') || '';
  const nonce = form.get('nonce') || '';

  if (accountId !== user) {
    return jsonResponse({ error: 'Account mismatch' }, 403);
  }

  const uc = getUserConfig(config, user);
  const privatePem = await env.APPDATA.get('oidc_private_key');
  const now = Math.floor(Date.now() / 1000);

  const token = await signJwt(privatePem, {
    iss: config.baseUrl,
    sub: uc.webId,
    aud: clientId,
    exp: now + 300, // 5 minutes
    iat: now,
    nonce: nonce || undefined,
    username: user,
    webid: uc.webId,
  });

  // Track connected RP
  const connected = await getConnectedClients(env.APPDATA, user);
  if (clientId && !connected.includes(clientId)) {
    connected.push(clientId);
    await setConnectedClients(env.APPDATA, user, connected);
  }

  return jsonResponse({ token });
}

/**
 * GET /fedcm/client-metadata?client_id=...
 * Fetches RP metadata (privacy policy, TOS) from the client_id URL.
 */
export async function handleFedCMClientMetadata(reqCtx) {
  const { url } = reqCtx;
  const clientId = url.searchParams.get('client_id') || '';

  if (!clientId || !clientId.startsWith('http')) {
    return jsonResponse({ error: 'Invalid client_id' }, 400);
  }

  if (!validateExternalUrl(clientId)) {
    return jsonResponse({ error: 'Invalid client_id URL' }, 400);
  }

  try {
    const res = await fetch(clientId, {
      headers: { 'Accept': 'application/ld+json, application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return jsonResponse({ privacy_policy_url: '', terms_of_service_url: '' });
    }
    const doc = await res.json();
    return jsonResponse({
      privacy_policy_url: doc.privacy_policy_url || doc.policy_uri || '',
      terms_of_service_url: doc.terms_of_service_url || doc.tos_uri || '',
    });
  } catch {
    return jsonResponse({ privacy_policy_url: '', terms_of_service_url: '' });
  }
}

/**
 * POST /fedcm/disconnect
 * Removes an RP from the user's connected clients list.
 * Requires session cookie + Sec-Fetch-Dest: webidentity header.
 */
export async function handleFedCMDisconnect(reqCtx) {
  const { request, user, env } = reqCtx;

  if (!requireFedCMHeader(request)) {
    return jsonResponse({ error: 'Missing Sec-Fetch-Dest: webidentity header' }, 403);
  }

  if (!user) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }

  const form = await request.formData();
  const clientId = form.get('client_id') || '';

  const connected = await getConnectedClients(env.APPDATA, user);
  const updated = connected.filter(c => c !== clientId);
  await setConnectedClients(env.APPDATA, user, updated);

  return jsonResponse({ account_id: user });
}

// ── RP Handler ───────────────────────────────────────

/**
 * POST /fedcm/verify
 * RP-side: receives a JWT token from client-side FedCM flow,
 * verifies the signature against the server's OIDC public key,
 * creates a session, and returns Set-Cookie.
 */
export async function handleFedCMVerify(reqCtx) {
  const { request, env, config } = reqCtx;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { token } = body;
  if (!token) {
    return jsonResponse({ error: 'Missing token' }, 400);
  }

  // Decode and verify JWT
  try {
    const [headerB64, payloadB64, sigB64] = token.split('.');
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return jsonResponse({ error: 'Token expired' }, 401);
    }

    // Check issuer
    if (payload.iss !== config.baseUrl) {
      return jsonResponse({ error: 'Issuer mismatch' }, 401);
    }

    // Verify signature against server's public key
    const publicPem = await env.APPDATA.get('oidc_public_key');
    const publicKey = await importPublicKey(publicPem);
    const signingInput = `${headerB64}.${payloadB64}`;
    const sigBytes = Uint8Array.from(atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const valid = await rsaVerify(publicKey, sigBytes, new TextEncoder().encode(signingInput));
    if (!valid) {
      return jsonResponse({ error: 'Invalid signature' }, 401);
    }

    // Extract username from token
    const username = payload.username;
    if (!username || !await userExists(env.APPDATA, username)) {
      return jsonResponse({ error: 'Unknown user' }, 401);
    }

    // Check if user is disabled
    const meta = await getUser(env.APPDATA, username);
    if (meta && meta.disabled) {
      return jsonResponse({ error: 'Account disabled' }, 403);
    }

    // Create session
    const sessionToken = await createSession(env.APPDATA, username);

    return new Response(JSON.stringify({ success: true, username }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${config.protocol === 'https' ? '; Secure' : ''}`,
        'Set-Login': 'logged-in',
      },
    });
  } catch (e) {
    console.error('FedCM verify error:', e);
    return jsonResponse({ error: 'Token verification failed' }, 401);
  }
}

// ── External IdP Verification ────────────────────────

/**
 * POST /fedcm/external-verify
 * Verifies a JWT token from an external FedCM identity provider,
 * links or creates a local account.
 *
 * Request body: { token, idpId }
 */
export async function handleFedCMExternalVerify(reqCtx) {
  const { request, env, config } = reqCtx;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { token, idpId } = body;
  if (!token || !idpId) {
    return jsonResponse({ error: 'Missing token or idpId' }, 400);
  }

  // Look up IdP config
  const idpList = JSON.parse(await env.APPDATA.get('fedcm_external_idps') || '[]');
  const idp = idpList.find(p => p.id === idpId);
  if (!idp) {
    return jsonResponse({ error: 'Unknown identity provider' }, 400);
  }

  // Determine issuer
  const issuer = idp.issuer || new URL(idp.configURL).origin;

  // Discover JWKS URI from OpenID configuration
  let jwksUri;
  try {
    const oidcRes = await fetch(`${issuer}/.well-known/openid-configuration`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!oidcRes.ok) {
      throw new Error(`OpenID config fetch failed: ${oidcRes.status}`);
    }
    const oidcConfig = await oidcRes.json();
    jwksUri = oidcConfig.jwks_uri;
    if (!jwksUri) {
      throw new Error('No jwks_uri in OpenID configuration');
    }
  } catch (e) {
    console.error('OIDC discovery error:', e);
    return jsonResponse({ error: 'Failed to discover IdP JWKS' }, 502);
  }

  // Verify the JWT against the IdP's JWKS
  let payload;
  try {
    payload = await verifyJwtWithJwks(token, jwksUri, idp.clientId, issuer);
  } catch (e) {
    console.error('External JWT verification error:', e);
    return jsonResponse({ error: 'Token verification failed: ' + e.message }, 401);
  }

  // Extract identity from token
  const sub = payload.sub;
  if (!sub) {
    return jsonResponse({ error: 'Token missing sub claim' }, 401);
  }
  const email = payload.email || '';
  const name = payload.name || '';
  const picture = payload.picture || '';

  // Check for existing linked identity
  const linkedUsername = await env.APPDATA.get(`fedcm_link:${idpId}:${sub}`);

  if (linkedUsername) {
    // User already linked — log them in
    if (!await userExists(env.APPDATA, linkedUsername)) {
      return jsonResponse({ error: 'Linked account no longer exists' }, 401);
    }

    const meta = await getUser(env.APPDATA, linkedUsername);
    if (meta && meta.disabled) {
      return jsonResponse({ error: 'Account disabled' }, 403);
    }

    const sessionToken = await createSession(env.APPDATA, linkedUsername);

    return new Response(JSON.stringify({ success: true, username: linkedUsername }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Set-Cookie': `session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${config.protocol === 'https' ? '; Secure' : ''}`,
        'Set-Login': 'logged-in',
      },
    });
  }

  // Not linked — check if registration is open
  if (config.registrationMode === 'closed') {
    return jsonResponse({ error: 'Registration is closed' }, 403);
  }

  // Create a pending registration token
  const regToken = generatePendingToken();
  await env.APPDATA.put(`fedcm_pending:${regToken}`, JSON.stringify({
    idpId,
    sub,
    email,
    name,
    picture,
  }), { expirationTtl: 600 }); // 10 minutes

  return jsonResponse({ needsRegistration: true, registrationToken: regToken });
}

/**
 * Generate a cryptographically random token for pending registrations.
 */
function generatePendingToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
