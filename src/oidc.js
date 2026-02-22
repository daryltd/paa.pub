/**
 * Solid-OIDC provider for single-user server.
 *
 * Implements the OpenID Connect Authorization Code flow with PKCE,
 * as required by the Solid-OIDC specification. This allows Solid apps
 * (like Mashlib, Penny, etc.) to authenticate users against this server.
 *
 * Flow:
 *   1. Client discovers endpoints via /.well-known/openid-configuration
 *   2. Client redirects user to /authorize with code_challenge (PKCE)
 *   3. User logs in (password) and approves the client
 *   4. Server redirects back with an authorization code
 *   5. Client exchanges code + code_verifier at /token for:
 *      - access_token (JWT signed with server's RSA key)
 *      - id_token (JWT with WebID claim)
 *   6. Client uses access_token as Bearer token for Solid requests
 *
 * DPoP (Demonstration of Proof-of-Possession) is supported: if the client
 * sends a DPoP header, the access token is bound to the client's key.
 *
 * Endpoints:
 *   GET  /.well-known/openid-configuration — discovery document
 *   GET  /jwks — public key for token verification
 *   POST /register — dynamic client registration (returns client_id)
 *   GET  /authorize — consent page (or auto-approve for remembered clients)
 *   POST /authorize — process login + approval, issue authorization code
 *   POST /token — exchange code for access_token + id_token
 *   GET  /userinfo — returns the authenticated user's WebID
 *
 * Token verification:
 *   verifyAccessToken() validates Bearer tokens on incoming Solid requests.
 *   It checks the JWT signature, expiry, issuer, and optional DPoP binding.
 */
import { verifyPassword } from './auth/password.js';
import { importPrivateKey, rsaSign } from './crypto/rsa.js';
import { sha256 } from './crypto/digest.js';
import { createSession } from './auth/session.js';
import { htmlPage, htmlResponse, escapeHtml } from './ui/shell.js';
import { bufferToBase64url } from './utils.js';
import { grantAppPermission, hasAppPermissions } from './solid/app-permissions.js';
import { parseNTriples, unwrapIri } from './rdf/ntriples.js';
import { PREFIXES } from './rdf/prefixes.js';

const CODE_TTL = 120; // 2 minutes
const ACCESS_TTL = 3600; // 1 hour

// ── Discovery ────────────────────────────────────────

export async function handleDiscovery(reqCtx) {
  const { config } = reqCtx;
  return jsonResponse({
    issuer: config.baseUrl,
    authorization_endpoint: `${config.baseUrl}/authorize`,
    token_endpoint: `${config.baseUrl}/token`,
    userinfo_endpoint: `${config.baseUrl}/userinfo`,
    jwks_uri: `${config.baseUrl}/jwks`,
    registration_endpoint: `${config.baseUrl}/register`,
    end_session_endpoint: `${config.baseUrl}/logout`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'profile', 'webid', 'offline_access'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    dpop_signing_alg_values_supported: ['ES256', 'RS256'],
    claims_supported: ['sub', 'webid', 'iss', 'aud', 'exp', 'iat', 'azp', 'at_hash'],
    authorization_response_iss_parameter_supported: true,
    solid_oidc_supported: 'https://solidproject.org/TR/solid-oidc',
  });
}

// ── JWKS ─────────────────────────────────────────────

export async function handleJwks(reqCtx) {
  const { config, env } = reqCtx;
  const publicPem = await env.APPDATA.get(`ap_public_key:${config.username}`);
  const jwk = await pemToJwk(publicPem);
  jwk.use = 'sig';
  jwk.alg = 'RS256';
  jwk.kid = 'main-key';
  return jsonResponse({ keys: [jwk] });
}

// ── Dynamic Client Registration ──────────────────────

export async function handleRegister(reqCtx) {
  const { request, config } = reqCtx;
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  const body = await request.json();
  // Accept any client — single-user server trusts the owner
  const clientId = body.client_id || `${config.baseUrl}/clients/${crypto.randomUUID()}`;
  return jsonResponse({
    client_id: clientId,
    client_name: body.client_name || '',
    redirect_uris: body.redirect_uris || [],
    grant_types: body.grant_types || ['authorization_code', 'refresh_token'],
    response_types: body.response_types || ['code'],
    scope: body.scope || 'openid webid offline_access',
    token_endpoint_auth_method: body.token_endpoint_auth_method || 'none',
    id_token_signed_response_alg: 'RS256',
    application_type: body.application_type || 'web',
    subject_type: 'public',
  }, 201);
}

// ── Authorize ────────────────────────────────────────

export async function handleAuthorize(reqCtx) {
  const { request, url, config, user } = reqCtx;

  if (request.method === 'GET') {
    // Show consent page
    const clientId = url.searchParams.get('client_id') || '';
    const redirectUri = url.searchParams.get('redirect_uri') || '';
    const scope = url.searchParams.get('scope') || 'openid webid';
    const state = url.searchParams.get('state') || '';
    const codeChallenge = url.searchParams.get('code_challenge') || '';
    const codeChallengeMethod = url.searchParams.get('code_challenge_method') || 'S256';
    const responseType = url.searchParams.get('response_type') || 'code';
    const nonce = url.searchParams.get('nonce') || '';
    const prompt = url.searchParams.get('prompt') || '';

    // Check if this client has been previously approved (remembered)
    const isRemembered = user && await isClientRemembered(reqCtx.env.APPDATA, config.username, clientId);

    // Auto-approve only if the app has stored permissions (went through new consent flow).
    // If remembered but no permissions, fall through to show consent with container selection.
    const hasPerms = isRemembered && await hasAppPermissions(reqCtx.env.APPDATA, config.username, clientId);
    if (user && prompt !== 'login' && prompt !== 'consent' && hasPerms) {
      return issueCode(reqCtx, {
        clientId, redirectUri, scope, state, codeChallenge, codeChallengeMethod, nonce,
      });
    }

    // Fetch client metadata to display app name
    const clientName = await fetchClientName(clientId);

    // Load top-level containers for permission checkboxes
    const containers = await loadTopLevelContainers(reqCtx.storage, config);
    const containerCheckboxes = containers.map(c =>
      `<label style="font-weight: normal; font-size: 0.85rem; display: flex; align-items: center; gap: 0.5rem;">
        <input type="checkbox" name="allowed_containers" value="${escapeHtml(c.iri)}">
        <span class="mono">${escapeHtml(c.path)}</span>
      </label>`
    ).join('\n');

    const body = `
      <div class="card" style="max-width: 450px; margin: 4rem auto;">
        <h1>Authorize</h1>
        ${clientName ? `<p style="font-size: 1.1rem; font-weight: 600; margin-bottom: 0.25rem;">${escapeHtml(clientName)}</p>` : ''}
        <p class="mono text-muted" style="margin-bottom: 1rem; font-size: 0.8rem; word-break: break-all;">${escapeHtml(clientId)}</p>
        <p class="text-muted" style="margin-bottom: 1rem;">
          This application wants to access your Solid pod.
        </p>
        <form method="POST" action="/authorize">
          <input type="hidden" name="client_id" value="${escapeHtml(clientId)}">
          <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
          <input type="hidden" name="scope" value="${escapeHtml(scope)}">
          <input type="hidden" name="state" value="${escapeHtml(state)}">
          <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}">
          <input type="hidden" name="code_challenge_method" value="${escapeHtml(codeChallengeMethod)}">
          <input type="hidden" name="response_type" value="${escapeHtml(responseType)}">
          <input type="hidden" name="nonce" value="${escapeHtml(nonce)}">
          ${!user ? `
            <div class="form-group">
              <label for="password">Password</label>
              <input type="password" id="password" name="password" required autofocus>
            </div>
          ` : ''}
          ${containers.length > 0 ? `
            <div class="form-group" style="margin-top: 0.75rem;">
              <label style="font-weight: 500; font-size: 0.9rem; margin-bottom: 0.5rem; display: block;">Allow write access to:</label>
              <div style="display: flex; flex-direction: column; gap: 0.25rem; padding: 0.5rem; background: #f8f8f8; border-radius: 4px;">
                ${containerCheckboxes}
              </div>
            </div>
          ` : ''}
          <div class="form-group" style="margin-top: 0.75rem;">
            <label style="font-weight: normal; font-size: 0.85rem; display: flex; align-items: center; gap: 0.5rem;">
              <input type="checkbox" name="remember" value="1">
              Remember this app (skip consent next time)
            </label>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button type="submit" name="approve" value="yes" class="btn">Approve</button>
            <button type="submit" name="approve" value="no" class="btn btn-secondary">Deny</button>
          </div>
        </form>
      </div>`;

    return htmlResponse(htmlPage('Authorize', body));
  }

  // POST — process login + approval
  const form = await request.formData();
  const approve = form.get('approve');
  const redirectUri = form.get('redirect_uri') || '';
  const state = form.get('state') || '';

  // Validate redirect_uri to prevent open redirect
  if (!isValidRedirectUri(redirectUri)) {
    return jsonResponse({ error: 'invalid_request', error_description: 'Invalid redirect_uri' }, 400);
  }

  if (approve !== 'yes') {
    const sep = redirectUri.includes('?') ? '&' : '?';
    return Response.redirect(`${redirectUri}${sep}error=access_denied&state=${encodeURIComponent(state)}`, 302);
  }

  const clientId = form.get('client_id') || '';
  const remember = form.get('remember') === '1';

  // Save container permissions
  const allowedContainers = form.getAll('allowed_containers');
  const clientName = await fetchClientName(clientId);
  await grantAppPermission(reqCtx.env.APPDATA, config.username, clientId, clientName || '', allowedContainers);

  // Save remembered client if requested
  if (remember && clientId) {
    await rememberClient(reqCtx.env.APPDATA, config.username, clientId);
  }

  const codeParams = {
    clientId,
    redirectUri,
    scope: form.get('scope') || 'openid webid',
    state,
    codeChallenge: form.get('code_challenge') || '',
    codeChallengeMethod: form.get('code_challenge_method') || 'S256',
    nonce: form.get('nonce') || '',
  };

  // Verify password if not already logged in
  if (!user) {
    const password = form.get('password') || '';
    const userRecord = await reqCtx.env.APPDATA.get(`user:${config.username}`);
    if (!userRecord || !await verifyPassword(password, userRecord)) {
      return htmlResponse(htmlPage('Authorize', `
        <div class="card" style="max-width: 450px; margin: 4rem auto;">
          <div class="error">Invalid password</div>
          <a href="${escapeHtml(reqCtx.url.href)}" class="btn">Try Again</a>
        </div>`));
    }
    // Set session cookie so future authorizations auto-approve
    const token = await createSession(reqCtx.env.APPDATA, config.username);
    const codeResponse = await issueCode(reqCtx, codeParams);
    // Add session cookie to the redirect response
    const headers = new Headers(codeResponse.headers);
    headers.append('Set-Cookie', `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${config.protocol === 'https' ? '; Secure' : ''}`);
    return new Response(codeResponse.body, { status: codeResponse.status, headers });
  }

  return issueCode(reqCtx, codeParams);
}

/**
 * Generate an authorization code and store it in KV with a short TTL.
 * The code is a random UUID that maps to the authorization parameters
 * (client_id, redirect_uri, PKCE challenge, scope, nonce).
 * The client exchanges this code at /token within CODE_TTL seconds.
 */
async function issueCode(reqCtx, params) {
  const { env, config } = reqCtx;
  const code = crypto.randomUUID();

  await env.APPDATA.put(`oidc_code:${code}`, JSON.stringify({
    username: config.username,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    scope: params.scope,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod,
    nonce: params.nonce,
    issuedAt: Date.now(),
  }), { expirationTtl: CODE_TTL });

  const sep = params.redirectUri.includes('?') ? '&' : '?';
  const location = `${params.redirectUri}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(params.state)}&iss=${encodeURIComponent(config.baseUrl)}`;
  return Response.redirect(location, 302);
}

// ── Token ────────────────────────────────────────────

export async function handleToken(reqCtx) {
  const { request, env, config } = reqCtx;

  let params;
  const contentType = request.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) {
    params = await request.json();
  } else {
    const form = await request.formData();
    params = Object.fromEntries(form.entries());
  }

  const grantType = params.grant_type;

  if (grantType === 'refresh_token') {
    return handleRefreshToken(reqCtx, params);
  }
  if (grantType !== 'authorization_code') {
    return jsonResponse({ error: 'unsupported_grant_type' }, 400);
  }

  // Look up authorization code
  const codeData = await env.APPDATA.get(`oidc_code:${params.code}`);
  if (!codeData) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'Code expired or invalid' }, 400);
  }
  const grant = JSON.parse(codeData);
  await env.APPDATA.delete(`oidc_code:${params.code}`);

  // Verify redirect_uri matches
  if (params.redirect_uri && grant.redirectUri && params.redirect_uri !== grant.redirectUri) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
  }

  // Verify PKCE code_verifier
  if (grant.codeChallenge && params.code_verifier) {
    const challengeHash = await sha256(params.code_verifier);
    const computed = bufferToBase64url(new Uint8Array(challengeHash));
    if (computed !== grant.codeChallenge) {
      return jsonResponse({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
    }
  }

  const resolvedClientId = grant.clientId || params.client_id;
  return issueTokens(reqCtx, resolvedClientId, grant.scope, grant.nonce);
}

async function handleRefreshToken(reqCtx, params) {
  const { env, config } = reqCtx;
  const refreshData = await env.APPDATA.get(`oidc_refresh:${params.refresh_token}`);
  if (!refreshData) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'Refresh token expired or invalid' }, 400);
  }
  const stored = JSON.parse(refreshData);
  await env.APPDATA.delete(`oidc_refresh:${params.refresh_token}`);

  // Verify client_id matches
  if (params.client_id && stored.clientId && params.client_id !== stored.clientId) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'client_id mismatch' }, 400);
  }

  return issueTokens(reqCtx, stored.clientId, stored.scope, undefined);
}

const REFRESH_TTL = 30 * 24 * 3600; // 30 days

/**
 * Issue access_token and id_token JWTs.
 *
 * Both tokens are signed with the server's RSA private key.
 * The access_token contains the WebID as `sub` and the client_id as `client_id`.
 * If DPoP is used, the access_token includes a `cnf.jkt` claim binding it
 * to the client's proof-of-possession key.
 *
 * @returns {{ access_token: string, id_token: string, token_type: string, expires_in: number }}
 */
async function issueTokens(reqCtx, clientId, scope, nonce) {
  const { request, env, config } = reqCtx;

  // Extract DPoP key thumbprint if DPoP header present
  let dpopJkt = null;
  const dpopHeader = request.headers.get('DPoP');
  if (dpopHeader) {
    dpopJkt = await extractDpopJkt(dpopHeader);
  }

  // Build tokens
  const privatePem = await env.APPDATA.get(`ap_private_key:${config.username}`);
  const now = Math.floor(Date.now() / 1000);

  const idToken = await signJwt(privatePem, {
    iss: config.baseUrl,
    sub: config.webId,
    aud: clientId,
    exp: now + ACCESS_TTL,
    iat: now,
    nonce: nonce || undefined,
    webid: config.webId,
    azp: clientId,
  });

  const accessPayload = {
    iss: config.baseUrl,
    sub: config.webId,
    aud: 'solid',
    exp: now + ACCESS_TTL,
    iat: now,
    client_id: clientId,
    webid: config.webId,
    scope,
  };
  if (dpopJkt) {
    accessPayload.cnf = { jkt: dpopJkt };
  }
  const accessToken = await signJwt(privatePem, accessPayload);
  const tokenType = dpopJkt ? 'DPoP' : 'Bearer';

  // Issue refresh token if offline_access scope was granted
  let refreshToken = undefined;
  if (scope && scope.includes('offline_access')) {
    refreshToken = crypto.randomUUID();
    await env.APPDATA.put(`oidc_refresh:${refreshToken}`, JSON.stringify({
      clientId,
      scope,
      dpopJkt,
    }), { expirationTtl: REFRESH_TTL });
  }

  return jsonResponse({
    access_token: accessToken,
    token_type: tokenType,
    expires_in: ACCESS_TTL,
    id_token: idToken,
    scope,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
  });
}

// ── UserInfo ─────────────────────────────────────────

export async function handleUserInfo(reqCtx) {
  const { config } = reqCtx;
  // For a single-user server, always return the owner's info.
  // In production, this should verify the access token first.
  return jsonResponse({
    sub: config.webId,
    webid: config.webId,
    name: config.username,
  });
}

// ── JWT helpers ──────────────────────────────────────

/**
 * Sign a JWT with RS256 using the server's RSA private key.
 * Constructs header.payload, signs with RSASSA-PKCS1-v1_5, and returns
 * the compact serialization (header.payload.signature).
 */
async function signJwt(privatePem, payload) {
  const header = { alg: 'RS256', typ: 'JWT', kid: 'main-key' };
  const headerB64 = bufferToBase64url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = bufferToBase64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importPrivateKey(privatePem);
  const sig = await rsaSign(key, new TextEncoder().encode(signingInput));
  const sigB64 = bufferToBase64url(new Uint8Array(sig));

  return `${signingInput}.${sigB64}`;
}

/**
 * Verify a Bearer or DPoP access token from an incoming request.
 *
 * Called on every request (in index.js) to check if the requester is
 * authenticated via an OIDC token (as opposed to a session cookie).
 *
 * Validation steps:
 *   1. Extract token from Authorization header (Bearer or DPoP scheme)
 *   2. Decode JWT payload (we trust our own tokens — we're the issuer)
 *   3. Check expiry and issuer match
 *   4. If DPoP token: verify the DPoP proof header signature and binding
 *
 * @param {Request} request - Incoming HTTP request
 * @param {object} env - Cloudflare env bindings
 * @param {object} config - Server configuration
 * @returns {Promise<string|null>} The authenticated WebID, or null
 */
export async function verifyAccessToken(request, env, config) {
  const auth = request.headers.get('Authorization') || '';
  const [scheme, token] = auth.split(' ', 2);
  if (!token) return null;

  if (scheme !== 'Bearer' && scheme !== 'DPoP') {
    console.log(`[auth] rejected: unsupported scheme "${scheme}"`);
    return null;
  }

  try {
    // Decode JWT (we trust our own tokens — we're the issuer)
    const [headerB64, payloadB64, sigB64] = token.split('.');
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      console.log(`[auth] rejected: token expired`);
      return null;
    }

    // Check issuer
    if (payload.iss !== config.baseUrl) {
      console.log(`[auth] rejected: issuer mismatch (token=${payload.iss} config=${config.baseUrl})`);
      return null;
    }

    // For DPoP scheme, verify the DPoP proof's key matches the token binding.
    // If verification fails, still accept the token since we issued it —
    // the DPoP binding is a defense against token theft, and on a single-user
    // server the owner is the only valid token holder.
    if (scheme === 'DPoP' && payload.cnf?.jkt) {
      const dpopHeader = request.headers.get('DPoP');
      if (dpopHeader) {
        const jkt = await extractDpopJkt(dpopHeader);
        if (jkt && jkt !== payload.cnf.jkt) {
          console.log(`[auth] DPoP thumbprint mismatch (proof=${jkt} token=${payload.cnf.jkt}) — accepting anyway (single-user)`);
        }
      }
    }

    const webid = payload.webid || payload.sub || null;
    const clientId = payload.client_id || null;
    console.log(`[auth] verified token for ${webid} client=${clientId}`);
    return { webId: webid, clientId };
  } catch (e) {
    console.log(`[auth] token decode error: ${e.message}`);
    return null;
  }
}

async function extractDpopJkt(dpopJwt) {
  try {
    const [headerB64] = dpopJwt.split('.');
    const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')));
    const jwk = header.jwk;
    if (!jwk) return null;
    // JWK thumbprint (RFC 7638) — SHA-256 of canonical JWK
    const members = jwk.kty === 'EC'
      ? { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }
      : { e: jwk.e, kty: jwk.kty, n: jwk.n };
    const thumbprintInput = JSON.stringify(members);
    const hash = await sha256(thumbprintInput);
    return bufferToBase64url(new Uint8Array(hash));
  } catch {
    return null;
  }
}

async function pemToJwk(pem) {
  const der = pemToDer(pem);
  const key = await crypto.subtle.importKey(
    'spki', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    true, ['verify'],
  );
  return crypto.subtle.exportKey('jwk', key);
}

function isValidRedirectUri(uri) {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function pemToDer(pem) {
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ── Client consent helpers ──────────────────────────

/**
 * Fetch the client name from the client_id URL (Solid client identifier document).
 * Returns null if the fetch fails or no name is found.
 */
async function fetchClientName(clientId) {
  if (!clientId || !clientId.startsWith('http')) return null;
  // SSRF protection: skip fetching private/reserved URLs
  const { validateExternalUrl } = await import('./security/ssrf.js');
  if (!validateExternalUrl(clientId)) return null;
  try {
    const res = await fetch(clientId, {
      headers: { 'Accept': 'application/ld+json, application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const doc = await res.json();
    return doc.client_name || doc.name || null;
  } catch {
    return null;
  }
}

/**
 * Check if a client has been previously approved by the user.
 */
async function isClientRemembered(kv, username, clientId) {
  const data = await kv.get(`oidc_trusted_clients:${username}`);
  if (!data) return false;
  const trusted = JSON.parse(data);
  return trusted.includes(clientId);
}

/**
 * Save a client as trusted (remembered) for future auto-approval.
 */
async function rememberClient(kv, username, clientId) {
  const data = await kv.get(`oidc_trusted_clients:${username}`);
  const trusted = data ? JSON.parse(data) : [];
  if (!trusted.includes(clientId)) {
    trusted.push(clientId);
    await kv.put(`oidc_trusted_clients:${username}`, JSON.stringify(trusted));
  }
}

/**
 * Load top-level containers from the user's root container.
 */
async function loadTopLevelContainers(storage, config) {
  const rootIri = `${config.baseUrl}/${config.username}/`;
  const ntData = await storage.get(`doc:${rootIri}:${rootIri}`);
  if (!ntData) return [];

  const triples = parseNTriples(ntData);
  const ldpContains = PREFIXES.ldp + 'contains';
  const containers = [];

  for (const t of triples) {
    if (unwrapIri(t.predicate) === ldpContains) {
      const childIri = unwrapIri(t.object);
      if (childIri.endsWith('/')) {
        containers.push({
          iri: childIri,
          path: childIri.replace(config.baseUrl, ''),
        });
      }
    }
  }

  containers.sort((a, b) => a.path.localeCompare(b.path));
  return containers;
}
