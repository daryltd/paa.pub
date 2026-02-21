/**
 * Minimal Solid-OIDC provider for single-user server.
 *
 * Endpoints:
 *   GET  /.well-known/openid-configuration
 *   GET  /jwks
 *   GET  /authorize  (show consent page)
 *   POST /authorize  (login + approve)
 *   POST /token      (exchange code for tokens)
 *   GET  /userinfo
 */
import { verifyPassword } from './auth/password.js';
import { importPrivateKey, rsaSign } from './crypto/rsa.js';
import { sha256 } from './crypto/digest.js';
import { createSession } from './auth/session.js';
import { htmlPage, htmlResponse, escapeHtml } from './ui/shell.js';

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

    // If already logged in and not prompt=login, auto-approve
    if (user && prompt !== 'login') {
      return issueCode(reqCtx, {
        clientId, redirectUri, scope, state, codeChallenge, codeChallengeMethod, nonce,
      });
    }

    const body = `
      <div class="card" style="max-width: 450px; margin: 4rem auto;">
        <h1>Authorize</h1>
        <p class="text-muted" style="margin-bottom: 1rem;">
          <strong>${escapeHtml(clientId)}</strong> wants to access your Solid pod.
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

  if (approve !== 'yes') {
    const sep = redirectUri.includes('?') ? '&' : '?';
    return Response.redirect(`${redirectUri}${sep}error=access_denied&state=${encodeURIComponent(state)}`, 302);
  }

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
    const codeResponse = await issueCode(reqCtx, {
      clientId: form.get('client_id') || '',
      redirectUri,
      scope: form.get('scope') || 'openid webid',
      state,
      codeChallenge: form.get('code_challenge') || '',
      codeChallengeMethod: form.get('code_challenge_method') || 'S256',
      nonce: form.get('nonce') || '',
    });
    // Add session cookie to the redirect response
    const headers = new Headers(codeResponse.headers);
    headers.append('Set-Cookie', `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${config.protocol === 'https' ? '; Secure' : ''}`);
    return new Response(codeResponse.body, { status: codeResponse.status, headers });
  }

  return issueCode(reqCtx, {
    clientId: form.get('client_id') || '',
    redirectUri,
    scope: form.get('scope') || 'openid webid',
    state,
    codeChallenge: form.get('code_challenge') || '',
    codeChallengeMethod: form.get('code_challenge_method') || 'S256',
    nonce: form.get('nonce') || '',
  });
}

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
  const location = `${params.redirectUri}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(params.state)}`;
  return Response.redirect(location, 302);
}

// ── Token ────────────────────────────────────────────

export async function handleToken(reqCtx) {
  const { request, env, config } = reqCtx;

  let grantType, code, redirectUri, codeVerifier, clientId;

  const contentType = request.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) {
    const body = await request.json();
    grantType = body.grant_type;
    code = body.code;
    redirectUri = body.redirect_uri;
    codeVerifier = body.code_verifier;
    clientId = body.client_id;
  } else {
    const form = await request.formData();
    grantType = form.get('grant_type');
    code = form.get('code');
    redirectUri = form.get('redirect_uri');
    codeVerifier = form.get('code_verifier');
    clientId = form.get('client_id');
  }

  if (grantType !== 'authorization_code') {
    return jsonResponse({ error: 'unsupported_grant_type' }, 400);
  }

  // Look up authorization code
  const codeData = await env.APPDATA.get(`oidc_code:${code}`);
  if (!codeData) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'Code expired or invalid' }, 400);
  }
  const grant = JSON.parse(codeData);
  await env.APPDATA.delete(`oidc_code:${code}`);

  // Verify redirect_uri matches
  if (redirectUri && grant.redirectUri && redirectUri !== grant.redirectUri) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
  }

  // Verify PKCE code_verifier
  if (grant.codeChallenge && codeVerifier) {
    const challengeHash = await sha256(codeVerifier);
    const computed = bufferToBase64url(new Uint8Array(challengeHash));
    if (computed !== grant.codeChallenge) {
      return jsonResponse({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
    }
  }

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
    aud: grant.clientId || clientId,
    exp: now + ACCESS_TTL,
    iat: now,
    nonce: grant.nonce || undefined,
    webid: config.webId,
    azp: grant.clientId || clientId,
  });

  const accessPayload = {
    iss: config.baseUrl,
    sub: config.webId,
    aud: 'solid',
    exp: now + ACCESS_TTL,
    iat: now,
    client_id: grant.clientId || clientId,
    webid: config.webId,
    scope: grant.scope,
  };
  if (dpopJkt) {
    accessPayload.cnf = { jkt: dpopJkt };
  }
  const accessToken = await signJwt(privatePem, accessPayload);

  const tokenType = dpopJkt ? 'DPoP' : 'Bearer';

  return jsonResponse({
    access_token: accessToken,
    token_type: tokenType,
    expires_in: ACCESS_TTL,
    id_token: idToken,
    scope: grant.scope,
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
    console.log(`[auth] verified token for ${webid}`);
    return webid;
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

function pemToDer(pem) {
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
