/**
 * Deno/OpenShift entry point for the Solid + ActivityPub server.
 *
 * Same route handlers as the Cloudflare Workers version (src/index.js),
 * adapted for Deno.serve() with:
 *   - OpenShiftAdapter (sparq in-memory store + MinIO) instead of Cloudflare KV/R2
 *   - Deno.env for configuration instead of Worker bindings
 *   - Static file serving from ./public/
 *   - X-Forwarded-For for client IP (instead of CF-Connecting-IP)
 */
import { OpenShiftAdapter } from './storage/openshift-adapter.js';
import { Router } from './router.js';
import { getConfig, getUserConfig } from './config-openshift.js';
import { ensureBootstrapped } from './bootstrap.js';
import { extractUser } from './auth/middleware.js';
import { userExists } from './users.js';
import { handleLogin, handleLogout } from './auth/session.js';
import { handleWebAuthnRegisterBegin, handleWebAuthnRegisterComplete, handleWebAuthnLoginBegin, handleWebAuthnLoginComplete, handleWebAuthnRename, handleWebAuthnDelete } from './auth/webauthn.js';
import { handleWebFinger } from './activitypub/webfinger.js';
import { handleUserDidDocument, handleServerDidDocument } from './did/document.js';
import { handleActor } from './activitypub/actor.js';
import { handleInbox } from './activitypub/inbox.js';
import { handleOutbox, handleOutboxPost, handleCompose, handleFollow, handleUnfollow, handleClearPendingFollows, handleAcceptFollowRequest, handleRejectFollowRequest } from './activitypub/outbox.js';
import { handleCollections } from './activitypub/collections.js';
import { handleLDP } from './solid/ldp.js';
import { applyCors } from './solid/cors.js';
import { renderLoginPage } from './ui/pages/login.js';
import { renderDashboard } from './ui/pages/dashboard.js';
import { renderActivityPage, renderRemoteFeed, handleMarkRead, handleMarkAllRead } from './ui/pages/activity.js';
import { renderStoragePage, handleStorageAction } from './ui/pages/storage.js';
import { renderAclEditor, handleAclUpdate } from './ui/pages/acl-editor.js';
import { renderProfileEditor, handleProfileUpdate, handleProfileIndexReset, handleDiscoverNs, handlePreviewLayout, handleListComponents, handleSaveComponent, handleImportComponent } from './ui/pages/profile-editor.js';
import { handleAppPermissionsUpdate } from './ui/pages/app-permissions.js';
import { renderSettings, handleSettingsUpdate } from './ui/pages/settings.js';
import { handleExport, handleCleanup } from './ui/pages/export.js';
import { handleActivityStream } from './ui/pages/activity-stream.js';
import { handleStorageDescription, handleSubscribe, handleNotificationChannel } from './solid/notification-handlers.js';
import { handleDiscovery, handleJwks, handleRegister, handleAuthorize, handleToken, handleUserInfo, verifyAccessToken } from './oidc.js';
import { renderSignupPage, handleSignup } from './auth/registration.js';
import { handleWebIdentity, handleFedCMConfig, handleFedCMAccounts, handleFedCMAssertion, handleFedCMClientMetadata, handleFedCMDisconnect, handleFedCMVerify, handleFedCMExternalVerify } from './fedcm.js';
import { renderPage } from './ui/shell.js';
import { resolveLanguage } from './i18n/index.js';
import { loadHtml } from './html-loader.js';
const landingTemplate = await loadHtml(import.meta.url, './ui/templates/landing.html', () => import('./ui/templates/landing.html'));
import { renderAdminDashboard } from './admin/dashboard.js';
import { renderAdminUsers, handleAdminUserAction } from './admin/users.js';
import { renderAdminFedCMIdps, handleAdminFedCMIdpAction } from './admin/fedcm-idps.js';
import { checkRateLimit, rateLimitResponse } from './security/rate-limit.js';
import { checkContentLength, getSizeLimit } from './security/size-limit.js';

// --- Build route table (identical to index.js) ---

function buildRouter() {
  const router = new Router();

  router.get('/.well-known/openid-configuration', handleDiscovery);
  router.get('/.well-known/oauth-authorization-server', handleDiscovery);
  router.get('/jwks', handleJwks);
  router.add('*', '/authorize', handleAuthorize);
  router.post('/token', handleToken);
  router.get('/userinfo', handleUserInfo);
  router.post('/register', handleRegister);

  router.get('/.well-known/web-identity', handleWebIdentity);
  router.get('/fedcm/config.json', handleFedCMConfig);
  router.get('/fedcm/accounts', handleFedCMAccounts);
  router.post('/fedcm/assertion', handleFedCMAssertion);
  router.get('/fedcm/client-metadata', handleFedCMClientMetadata);
  router.post('/fedcm/disconnect', handleFedCMDisconnect);
  router.post('/fedcm/verify', handleFedCMVerify);
  router.post('/fedcm/external-verify', handleFedCMExternalVerify);

  router.get('/.well-known/webfinger', handleWebFinger);
  router.get('/.well-known/did.json', handleServerDidDocument);
  router.get('/login', renderLoginPage);
  router.post('/login', handleLogin);
  router.post('/logout', handleLogout);

  router.get('/signup', renderSignupPage);
  router.post('/signup', handleSignup);

  router.post('/webauthn/register/begin', handleWebAuthnRegisterBegin);
  router.post('/webauthn/register/complete', handleWebAuthnRegisterComplete);
  router.post('/webauthn/login/begin', handleWebAuthnLoginBegin);
  router.post('/webauthn/login/complete', handleWebAuthnLoginComplete);
  router.post('/webauthn/rename', handleWebAuthnRename);
  router.post('/webauthn/delete', handleWebAuthnDelete);

  router.get('/admin', renderAdminDashboard);
  router.get('/admin/users', renderAdminUsers);
  router.post('/admin/users', handleAdminUserAction);
  router.get('/admin/fedcm-idps', renderAdminFedCMIdps);
  router.post('/admin/fedcm-idps', handleAdminFedCMIdpAction);

  router.get('/dashboard', renderDashboard);
  router.get('/activity', renderActivityPage);
  router.get('/activity/remote', renderRemoteFeed);
  router.post('/activity/mark-read', handleMarkRead);
  router.post('/activity/mark-all-read', handleMarkAllRead);
  router.get('/activity/stream', handleActivityStream);
  router.post('/compose', handleCompose);
  router.post('/follow', handleFollow);
  router.post('/unfollow', handleUnfollow);
  router.post('/activity/clear-pending', handleClearPendingFollows);
  router.post('/follow-requests/accept', handleAcceptFollowRequest);
  router.post('/follow-requests/reject', handleRejectFollowRequest);
  router.get('/storage/**', renderStoragePage);
  router.post('/storage/**', handleStorageAction);
  router.get('/acp/**', renderAclEditor);
  router.post('/acp/**', handleAclUpdate);

  router.get('/profile', renderProfileEditor);
  router.post('/profile', handleProfileUpdate);
  router.post('/profile/reset-index', handleProfileIndexReset);
  router.post('/profile/discover-ns', handleDiscoverNs);
  router.post('/profile/preview-layout', handlePreviewLayout);
  router.get('/profile/components', handleListComponents);
  router.post('/profile/components', handleSaveComponent);
  router.post('/profile/import-component', handleImportComponent);

  router.get('/settings', renderSettings);
  router.post('/settings', handleSettingsUpdate);
  router.get('/settings/export', handleExport);
  router.post('/settings/cleanup', handleCleanup);

  router.get('/app-permissions', () => new Response(null, { status: 302, headers: { 'Location': '/settings' } }));
  router.post('/app-permissions', handleAppPermissionsUpdate);

  router.get('/acl/**', (ctx) => {
    const aclPath = ctx.url.pathname.replace(/^\/acl/, '/acp');
    return new Response(null, { status: 301, headers: { 'Location': aclPath } });
  });
  router.get('/profile/card', handleActor);

  router.get('/:user/profile/card', handleActor);
  router.post('/inbox', handleInbox);
  router.post('/:user/inbox', handleInbox);
  router.get('/:user/outbox', handleOutbox);
  router.post('/:user/outbox', handleOutboxPost);
  router.get('/:user/followers', handleCollections);
  router.get('/:user/following', handleCollections);
  router.get('/:user/did.json', handleUserDidDocument);

  // Solid Notifications Protocol
  router.get('/:user/.notifications', handleStorageDescription);
  router.post('/:user/.notifications/subscribe', handleSubscribe);
  router.get('/:user/.notifications/channel/:id', handleNotificationChannel);
  router.add('*', '/:user/**', handleLDP);
  router.add('*', '/:user/', handleLDP);

  return router;
}

// --- Static file serving ---

const STATIC_TYPES = {
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.html': 'text/html',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

async function serveStatic(pathname) {
  const filePath = `./public${pathname}`;
  try {
    const data = await Deno.readFile(filePath);
    const ext = pathname.slice(pathname.lastIndexOf('.'));
    const contentType = STATIC_TYPES[ext] || 'application/octet-stream';
    return new Response(data, {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' },
    });
  } catch {
    return null;
  }
}

// --- Username extraction helper ---

function extractUsernameFromWebId(webId, baseUrl) {
  if (!webId || !baseUrl) return null;
  const prefix = baseUrl.replace(/\/$/, '') + '/';
  if (!webId.startsWith(prefix)) return null;
  const rest = webId.slice(prefix.length);
  const slash = rest.indexOf('/');
  return slash > 0 ? rest.slice(0, slash) : rest;
}

function getRateLimitCategory(method, pathname, handler) {
  if (handler === handleLogin || handler === handleAuthorize) return 'login';
  if (handler === handleWebAuthnLoginBegin || handler === handleWebAuthnLoginComplete) return 'webauthn';
  if (handler === handleToken) return 'token';
  if (handler === handleSignup || handler === handleRegister) return 'register';
  if (handler === handleInbox) return 'inbox';
  if (['PUT', 'POST', 'PATCH', 'DELETE'].includes(method) && handler === handleLDP) return 'write';
  return null;
}

// --- Initialize storage ---

let storage = null;
let initialized = false;
const router = buildRouter();

async function initStorage() {
  if (initialized) return;

  let minioClient = null;
  const bucket = Deno.env.get('MINIO_BUCKET') || 'paa-pub';
  const minioEndpoint = Deno.env.get('MINIO_ENDPOINT');

  if (minioEndpoint) {
    try {
      const { S3Client } = await import('https://deno.land/x/s3_lite_client@0.7.0/mod.ts');
      const s3 = new S3Client({
        endPoint: minioEndpoint,
        port: parseInt(Deno.env.get('MINIO_PORT') || '9000', 10),
        useSSL: Deno.env.get('MINIO_USE_SSL') === 'true',
        accessKey: Deno.env.get('MINIO_ACCESS_KEY') || 'minioadmin',
        secretKey: Deno.env.get('MINIO_SECRET_KEY') || 'minioadmin',
        bucket,
        pathStyle: true,
        region: Deno.env.get('MINIO_REGION') || 'us-east-1',
      });

      // Ensure bucket exists
      const exists = await s3.bucketExists();
      if (!exists) {
        await s3.makeBucket();
        console.log(`[storage] Created MinIO bucket: ${bucket}`);
      }

      // Sanitize S3 keys — replace characters invalid for MinIO object names
      const sanitizeKey = (key) => key.replace(/:/g, '_').replace(/\/\//g, '/');

      // Wrap s3_lite_client to match the adapter's expected interface
      minioClient = {
        async getObject(_bucket, key) {
          const resp = await s3.getObject(sanitizeKey(key));
          return resp.body;
        },
        async putObject(_bucket, key, data, _size, meta) {
          await s3.putObject(sanitizeKey(key), data, { metadata: meta });
        },
        async removeObject(_bucket, key) {
          await s3.deleteObject(sanitizeKey(key));
        },
        async statObject(_bucket, key) {
          const stat = await s3.statObject(sanitizeKey(key));
          return { size: stat.size, metaData: stat.metadata || {} };
        },
        async bucketExists() { return true; },
        async makeBucket() {},
      };

      console.log('[storage] MinIO connected via S3 client');
    } catch (e) {
      console.warn('[storage] MinIO unavailable, using filesystem fallback:', e.message);
      minioClient = null;
    }
  }

  // Filesystem fallback if MinIO isn't available
  if (!minioClient) {
    console.log('[storage] Using filesystem for snapshots and blobs');
    const dataDir = Deno.env.get('PAA_DATA_DIR') || './data';
    try { await Deno.mkdir(dataDir, { recursive: true }); } catch (_) {}
    minioClient = createFsBlobStore(dataDir);
  }

  storage = new OpenShiftAdapter(minioClient, bucket);
  await storage.init();
  initialized = true;
  console.log('[storage] OpenShift adapter initialized');
}

function createFsBlobStore(dataDir) {
  return {
    async getObject(_bucket, key) {
      try {
        const data = await Deno.readFile(`${dataDir}/${key}`);
        return (async function* () { yield data; })();
      } catch { throw { code: 'NoSuchKey' }; }
    },
    async putObject(_bucket, key, data, _size, meta) {
      const path = `${dataDir}/${key}`;
      const dir = path.substring(0, path.lastIndexOf('/'));
      try { await Deno.mkdir(dir, { recursive: true }); } catch (_) {}
      await Deno.writeFile(path, data instanceof Uint8Array ? data : new Uint8Array(data));
    },
    async removeObject(_bucket, key) {
      try { await Deno.remove(`${dataDir}/${key}`); } catch (_) {}
    },
    async statObject(_bucket, key) {
      const stat = await Deno.stat(`${dataDir}/${key}`);
      return { size: stat.size, metaData: {} };
    },
    async bucketExists() { return true; },
    async makeBucket() {},
  };
}

// --- Request handler ---

async function handleRequest(request) {
  try {
    await initStorage();

    const config = getConfig(null, request);
    const url = new URL(request.url);

    // Serve static assets
    if (url.pathname.startsWith('/css/') || url.pathname.startsWith('/scripts/') ||
        url.pathname.startsWith('/media/') || url.pathname === '/favicon.ico') {
      const staticResponse = await serveStatic(url.pathname);
      if (staticResponse) return staticResponse;
    }

    // Build env shim — handlers access env.APPDATA, env.TRIPLESTORE, env.BLOBS
    // All go through the same sparq-backed adapter
    const env = {
      TRIPLESTORE: storage,
      APPDATA: storage,
      BLOBS: storage,
      PAA_USERNAME: Deno.env.get('PAA_USERNAME') || 'admin',
      PAA_PASSWORD: Deno.env.get('PAA_PASSWORD') || '',
      PAA_DOMAIN: Deno.env.get('PAA_DOMAIN') || '',
      PAA_STORAGE_LIMIT: Deno.env.get('PAA_STORAGE_LIMIT') || '1GB',
      PAA_FEED_LIMIT: Deno.env.get('PAA_FEED_LIMIT') || '50',
      PAA_REGISTRATION: Deno.env.get('PAA_REGISTRATION') || 'open',
    };

    // ctx shim — fire-and-forget instead of Cloudflare's ctx.waitUntil
    const ctx = {
      waitUntil: (promise) => {
        promise.catch(err => console.error('[async]', err));
      },
    };

    // Fast-path for static metadata endpoints — no bootstrap/auth needed
    const pathname = url.pathname;
    if (pathname === '/.well-known/openid-configuration' ||
        pathname === '/.well-known/oauth-authorization-server') {
      const match = router.match(request.method, pathname);
      if (match) {
        const reqCtx = { request, env, ctx, url, config, user: null, userConfig: null, authMethod: null, clientId: null, params: match.params, storage, lang: 'en-US', userPrefs: null };
        return applyCors(await match.handler(reqCtx), request);
      }
    }

    // Bootstrap on first request (generates RSA keys — can be slow on first run)
    await ensureBootstrapped(env, config, storage);

    // Extract session user or OIDC token user
    let user = await extractUser(request, env);
    let authMethod = user ? 'session' : null;
    let clientId = null;

    if (!user) {
      const tokenResult = await verifyAccessToken(request, env, config);
      if (tokenResult) {
        const tokenUsername = extractUsernameFromWebId(tokenResult.webId, config.baseUrl);
        if (tokenUsername && await userExists(env.APPDATA, tokenUsername)) {
          user = tokenUsername;
          authMethod = 'oidc';
          clientId = tokenResult.clientId;
        }
      }
    }

    const userConfig = user ? getUserConfig(config, user) : null;

    let userPrefs = null;
    if (user) {
      const prefsRaw = await env.APPDATA.get(`user_prefs:${user}`);
      userPrefs = prefsRaw ? JSON.parse(prefsRaw) : null;
    }
    const lang = resolveLanguage(request, userPrefs);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return applyCors(new Response(null, { status: 204 }), request);
    }

    // Root page
    if (url.pathname === '/') {
      if (user) {
        return applyCors(new Response(null, { status: 302, headers: { 'Location': '/dashboard' } }), request);
      }
      const externalIdps = JSON.parse(await env.APPDATA.get('fedcm_external_idps') || '[]');
      const landing = await renderPage('Welcome', landingTemplate, {
        siteName: config.domain,
        registrationOpen: config.registrationMode !== 'closed',
        externalIdps,
        hasExternalIdps: externalIdps.length > 0,
      }, { lang });
      return applyCors(landing, request);
    }

    // Route dispatch
    const match = router.match(request.method, url.pathname);
    if (!match) {
      return applyCors(new Response('Not Found', { status: 404 }), request);
    }

    // Rate limiting (X-Forwarded-For instead of CF-Connecting-IP)
    const rateLimitCategory = getRateLimitCategory(request.method, url.pathname, match.handler);
    if (rateLimitCategory) {
      const ip = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || '0.0.0.0';
      const rl = await checkRateLimit(env.APPDATA, rateLimitCategory, ip);
      if (!rl.allowed) {
        return applyCors(rateLimitResponse(rl.retryAfter), request);
      }
    }

    // Request size limits
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const maxSize = getSizeLimit(request);
      const sizeCheck = checkContentLength(request, maxSize);
      if (sizeCheck) {
        return applyCors(sizeCheck, request);
      }
    }

    console.log(`[route] ${request.method} ${url.pathname} → handler=${match.handler?.name || 'unknown'} user=${user || 'anon'}`);

    const reqCtx = {
      request,
      env,
      ctx,
      url,
      config,
      user,
      userConfig,
      authMethod,
      clientId,
      params: match.params,
      storage,
      lang,
      userPrefs,
    };

    const response = await match.handler(reqCtx);
    return applyCors(response, request);

  } catch (err) {
    console.error('[error]', err);
    return applyCors(new Response('Internal Server Error', { status: 500 }), request);
  }
}

// --- Graceful shutdown ---

const ac = new AbortController();

Deno.addSignalListener('SIGTERM', async () => {
  console.log('[shutdown] SIGTERM received, saving snapshot...');
  if (storage) await storage.shutdown();
  ac.abort();
});

// --- Start server ---

const port = parseInt(Deno.env.get('PAA_SERVER_PORT') || '3000', 10);

console.log(`[server] Kaiāulu Pa'a starting on port ${port}`);

Deno.serve({
  port,
  signal: ac.signal,
  onListen: () => console.log(`[server] Listening on http://0.0.0.0:${port}/`),
}, handleRequest);
