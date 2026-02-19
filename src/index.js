import { Orchestrator } from '@s20e/host-core';
import { CloudflareAdapter } from '@s20e/adapters/cloudflare';
import { init, Kernel } from '@s20e/kernel';
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
import { renderAclEditor, handleAclUpdate } from './ui/pages/acl-editor.js';

let kernel = null;

function buildRouter() {
  const router = new Router();

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
  router.get('/acl/**', renderAclEditor);
  router.post('/acl/**', handleAclUpdate);

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
    // Init WASM kernel once
    if (!kernel) {
      await init();
      kernel = new Kernel();
    }

    const storage = new CloudflareAdapter(env.TRIPLESTORE, env.BLOBS);
    const orchestrator = new Orchestrator(kernel, storage);
    const config = getConfig(env);
    const url = new URL(request.url);

    // Bootstrap on first request
    await ensureBootstrapped(env, config, storage);

    // Extract session user
    const user = await extractUser(request, env);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return applyCors(new Response(null, { status: 204 }), request);
    }

    // Root redirect
    if (url.pathname === '/') {
      if (user) {
        return Response.redirect(`${config.baseUrl}/dashboard`, 302);
      }
      return Response.redirect(`${config.baseUrl}/login`, 302);
    }

    // Route dispatch
    const match = router.match(request.method, url.pathname);
    if (!match) {
      return applyCors(new Response('Not Found', { status: 404 }), request);
    }

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
      return applyCors(response, request);
    } catch (err) {
      console.error('Request error:', err);
      return applyCors(
        new Response('Internal Server Error', { status: 500 }),
        request,
      );
    }
  },
};
