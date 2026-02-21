import { Orchestrator } from '@s20e/host-core';
import { CloudflareAdapter } from '@s20e/adapters/cloudflare';
import { initSync, Kernel } from '@s20e/kernel';
import wasmModule from '../../s20e/packages/s20e-kernel/_wasm/s20e-kernel_bg.wasm';
import { Router } from './router.js';
import { getConfig } from './config.js';
import { ensureBootstrapped } from './bootstrap.js';
import { extractUser } from './auth/middleware.js';
import { handleLogin, handleLogout } from './auth/session.js';
import { handleWebAuthnRegisterBegin, handleWebAuthnRegisterComplete, handleWebAuthnLoginBegin, handleWebAuthnLoginComplete } from './auth/webauthn.js';
import { handleWebFinger } from './activitypub/webfinger.js';
import { handleActor } from './activitypub/actor.js';
import { handleInbox } from './activitypub/inbox.js';
import { handleOutbox, handleCompose, handleFollow, handleUnfollow } from './activitypub/outbox.js';
import { handleCollections } from './activitypub/collections.js';
import { handleLDP } from './solid/ldp.js';
import { applyCors } from './solid/cors.js';
import { renderLoginPage } from './ui/pages/login.js';
import { renderDashboard } from './ui/pages/dashboard.js';
import { renderActivityPage } from './ui/pages/activity.js';
import { renderStoragePage, handleStorageAction } from './ui/pages/storage.js';
import { renderAclEditor, handleAclUpdate } from './ui/pages/acl-editor.js';  // ACP editor (file retains old name for git history)
import { handleDiscovery, handleJwks, handleRegister, handleAuthorize, handleToken, handleUserInfo, verifyAccessToken } from './oidc.js';

let kernel = null;

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

  // Authenticated UI routes
  router.get('/dashboard', renderDashboard);
  router.get('/activity', renderActivityPage);
  router.post('/compose', handleCompose);
  router.post('/follow', handleFollow);
  router.post('/unfollow', handleUnfollow);
  router.get('/storage/**', renderStoragePage);
  router.post('/storage/**', handleStorageAction);
  router.get('/acp/**', renderAclEditor);
  router.post('/acp/**', handleAclUpdate);
  // Legacy /acl/ redirect
  router.get('/acl/**', (ctx) => {
    const path = ctx.url.pathname.replace(/^\/acl\//, '');
    return new Response(null, { status: 302, headers: { 'Location': `/acp/${path}` } });
  });

  // Profile card at root level (single-user convenience)
  router.get('/profile/card', handleActor);

  // ActivityPub routes (content-negotiated)
  router.get('/:user/profile/card', handleActor);
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
    if (!user) {
      const webId = await verifyAccessToken(request, env, config);
      if (webId === config.webId) {
        user = config.username;
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

    console.log(`[route] ${request.method} ${url.pathname} → handler=${match.handler?.name || 'unknown'} params=${JSON.stringify(match.params)} user=${user || 'anon'}`);

    const reqCtx = {
      request,
      env,
      ctx,
      url,
      config,
      user,
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
      return new Response(`Error: ${err.message}`, { status: 500 });
   }
  },
};
