/**
 * Cloudflare Worker entry point for the Solid + ActivityPub server.
 *
 * This is the single fetch handler that processes every incoming HTTP request.
 * On each request it:
 *
 *   1. Initializes the s20e WASM kernel (once, on cold start)
 *   2. Creates a CloudflareAdapter wrapping KV (TRIPLESTORE) and R2 (BLOBS)
 *   3. Bootstraps the server on first-ever request (creates user, containers, keys)
 *   4. Extracts the authenticated user from session cookie or OIDC bearer token
 *   5. Matches the URL to a route handler and dispatches
 *   6. Wraps the response with CORS headers
 *
 * All route handlers receive a `reqCtx` object containing:
 *   - request    — the original Request
 *   - env        — Cloudflare Worker env bindings (KV, R2, secrets)
 *   - ctx        — Cloudflare execution context (for waitUntil)
 *   - url        — parsed URL object
 *   - config     — server config (username, domain, baseUrl, webId)
 *   - user       — authenticated username or null
 *   - authMethod — 'session' | 'oidc' | null
 *   - clientId   — OIDC client_id (from JWT) or null
 *   - params     — URL pattern parameters (e.g. { user: 'alice' })
 *   - orchestrator — s20e Orchestrator for SPARQL/WAC operations
 *   - storage    — CloudflareAdapter for direct KV/R2 access
 */
import { Orchestrator } from '@s20e/host-core';
import { CloudflareAdapter } from '@s20e/adapters/cloudflare';
import { initSync, Kernel } from '@s20e/kernel';
import wasmModule from '@s20e/kernel/_wasm/s20e-kernel_bg.wasm';
import { Router } from './router.js';
import { getConfig } from './config.js';
import { ensureBootstrapped } from './bootstrap.js';
import { extractUser } from './auth/middleware.js';
import { handleLogin, handleLogout } from './auth/session.js';
import { handleWebAuthnRegisterBegin, handleWebAuthnRegisterComplete, handleWebAuthnLoginBegin, handleWebAuthnLoginComplete, handleWebAuthnRename, handleWebAuthnDelete } from './auth/webauthn.js';
import { handleWebFinger } from './activitypub/webfinger.js';
import { handleActor } from './activitypub/actor.js';
import { handleInbox } from './activitypub/inbox.js';
import { handleOutbox, handleCompose, handleFollow, handleUnfollow, handleAcceptFollowRequest, handleRejectFollowRequest } from './activitypub/outbox.js';
import { handleCollections } from './activitypub/collections.js';
import { handleLDP } from './solid/ldp.js';
import { applyCors } from './solid/cors.js';
import { renderLoginPage } from './ui/pages/login.js';
import { renderDashboard } from './ui/pages/dashboard.js';
import { renderActivityPage, renderRemoteFeed, handleMarkRead, handleMarkAllRead } from './ui/pages/activity.js';
import { renderStoragePage, handleStorageAction } from './ui/pages/storage.js';
import { renderAclEditor, handleAclUpdate } from './ui/pages/acl-editor.js';  // ACP editor (file retains old name for git history)
import { renderProfileEditor, handleProfileUpdate, handleProfileIndexReset } from './ui/pages/profile-editor.js';
import { renderAppPermissions, handleAppPermissionsUpdate } from './ui/pages/app-permissions.js';
import { handleDiscovery, handleJwks, handleRegister, handleAuthorize, handleToken, handleUserInfo, verifyAccessToken } from './oidc.js';
import { checkRateLimit, rateLimitResponse } from './security/rate-limit.js';
import { checkContentLength, getSizeLimit } from './security/size-limit.js';

/** Singleton WASM kernel instance — initialized on first request. */
let kernel = null;

/**
 * Build the application route table.
 *
 * Routes are matched in registration order (first match wins).
 * Specific routes must be registered before wildcard catch-alls.
 * The LDP catch-all at the bottom handles all Solid protocol requests
 * to /{user}/** that aren't matched by more specific routes.
 */
function buildRouter() {
  const router = new Router();

  // OIDC endpoints
  router.get('/.well-known/openid-configuration', handleDiscovery);
  router.get('/jwks', handleJwks);
  router.add('*', '/authorize', handleAuthorize);
  router.post('/token', handleToken);
  router.get('/userinfo', handleUserInfo);
  router.post('/register', handleRegister);

  // Public routes
  router.get('/.well-known/webfinger', handleWebFinger);
  router.get('/login', renderLoginPage);
  router.post('/login', handleLogin);
  router.post('/logout', handleLogout);

  // WebAuthn
  router.post('/webauthn/register/begin', handleWebAuthnRegisterBegin);
  router.post('/webauthn/register/complete', handleWebAuthnRegisterComplete);
  router.post('/webauthn/login/begin', handleWebAuthnLoginBegin);
  router.post('/webauthn/login/complete', handleWebAuthnLoginComplete);
  router.post('/webauthn/rename', handleWebAuthnRename);
  router.post('/webauthn/delete', handleWebAuthnDelete);

  // Authenticated UI routes
  router.get('/dashboard', renderDashboard);
  router.get('/activity', renderActivityPage);
  router.get('/activity/remote', renderRemoteFeed);
  router.post('/activity/mark-read', handleMarkRead);
  router.post('/activity/mark-all-read', handleMarkAllRead);
  router.post('/compose', handleCompose);
  router.post('/follow', handleFollow);
  router.post('/unfollow', handleUnfollow);
  router.post('/follow-requests/accept', handleAcceptFollowRequest);
  router.post('/follow-requests/reject', handleRejectFollowRequest);
  router.get('/storage/**', renderStoragePage);
  router.post('/storage/**', handleStorageAction);
  router.get('/acp/**', renderAclEditor);
  router.post('/acp/**', handleAclUpdate);
  // Profile editor
  router.get('/profile', renderProfileEditor);
  router.post('/profile', handleProfileUpdate);
  router.post('/profile/reset-index', handleProfileIndexReset);

  // App permissions management
  router.get('/app-permissions', renderAppPermissions);
  router.post('/app-permissions', handleAppPermissionsUpdate);

  // Legacy /acl/ redirect
  router.get('/acl/**', (ctx) => {
    const path = ctx.url.pathname.replace(/^\/acl\//, '');
    return new Response(null, { status: 302, headers: { 'Location': `/acp/${path}` } });
  });

  // Profile card at root level (single-user convenience)
  router.get('/profile/card', handleActor);

  // ActivityPub routes (content-negotiated)
  router.get('/:user/profile/card', handleActor);
  router.post('/inbox', handleInbox);
  router.post('/:user/inbox', handleInbox);
  router.get('/:user/outbox', handleOutbox);
  router.get('/:user/followers', handleCollections);
  router.get('/:user/following', handleCollections);

  // LDP catch-all
  router.add('*', '/:user/**', handleLDP);
  router.add('*', '/:user/', handleLDP);

  return router;
}

const router = buildRouter();

/**
 * Determine the rate limit category for a matched route, if any.
 * Returns null if no rate limiting applies.
 */
function getRateLimitCategory(method, pathname, handler) {
  if (method === 'POST' && (pathname === '/login' || pathname === '/authorize')) return 'login';
  if (method === 'POST' && pathname.startsWith('/webauthn/login/')) return 'webauthn';
  if (method === 'POST' && pathname === '/token') return 'token';
  if (method === 'POST' && pathname === '/register') return 'register';
  if (method === 'POST' && (pathname === '/inbox' || pathname.match(/^\/[^/]+\/inbox$/))) return 'inbox';
  // LDP write operations
  if (handler === handleLDP && ['PUT', 'POST', 'PATCH', 'DELETE'].includes(method)) return 'write';
  return null;
}

export default {
  async fetch(request, env, ctx) {
   try {
    // Init WASM kernel once
    if (!kernel) {
      initSync(wasmModule);
      kernel = new Kernel();
    }

    const storage = new CloudflareAdapter(env.TRIPLESTORE, env.BLOBS);
    const orchestrator = new Orchestrator(kernel, storage);
    const config = getConfig(env, request);
    const url = new URL(request.url);

    // Bootstrap on first request
    await ensureBootstrapped(env, config, storage);

    // Extract session user (cookie) or OIDC token user
    let user = await extractUser(request, env);
    let authMethod = user ? 'session' : null;
    let clientId = null;

    if (!user) {
      const tokenResult = await verifyAccessToken(request, env, config);
      if (tokenResult && tokenResult.webId === config.webId) {
        user = config.username;
        authMethod = 'oidc';
        clientId = tokenResult.clientId;
      }
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return applyCors(new Response(null, { status: 204 }), request);
    }

    // Root redirect
    if (url.pathname === '/') {
      const dest = user ? '/dashboard' : '/login';
      return applyCors(new Response(null, { status: 302, headers: { 'Location': dest } }), request);
    }

    // Route dispatch
    const match = router.match(request.method, url.pathname);
    if (!match) {
      return applyCors(new Response('Not Found', { status: 404 }), request);
    }

    // --- Rate limiting ---
    const rateLimitCategory = getRateLimitCategory(request.method, url.pathname, match.handler);
    if (rateLimitCategory) {
      const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
      const rl = await checkRateLimit(env.APPDATA, rateLimitCategory, ip);
      if (!rl.allowed) {
        return applyCors(rateLimitResponse(rl.retryAfter), request);
      }
    }

    // --- Request size limits ---
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const maxSize = getSizeLimit(request);
      const sizeCheck = checkContentLength(request, maxSize);
      if (sizeCheck) {
        return applyCors(sizeCheck, request);
      }
    }

    console.log(`[route] ${request.method} ${url.pathname} → handler=${match.handler?.name || 'unknown'} params=${JSON.stringify(match.params)} user=${user || 'anon'} auth=${authMethod || 'none'}`);

    // Build the request context object passed to all route handlers.
    // This is the single "dependency injection" point — handlers never
    // access globals, they receive everything they need through reqCtx.
    const reqCtx = {
      request,
      env,
      ctx,
      url,
      config,
      user,
      authMethod,
      clientId,
      params: match.params,
      orchestrator,
      storage,
    };

    try {
      const response = await match.handler(reqCtx);
      if (response.status >= 400) {
        console.log(`[response] ${request.method} ${url.pathname} → ${response.status}`);
      }
      return applyCors(response, request);
    } catch (err) {
      console.error('Handler error:', err);
      return applyCors(
        new Response('Internal Server Error', { status: 500 }),
        request,
      );
    }
   } catch (err) {
      console.error('Top-level error:', err);
      return applyCors(new Response('Internal Server Error', { status: 500 }), request);
   }
  },
};
