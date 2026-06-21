/**
 * S2S inbox handler: verify HTTP Signature, dispatch by activity type.
 */
import { verifyRequestSignature } from './httpsig.js';
import { fetchRemoteActor, getActorPublicKey } from './remote.js';
import { processFollow, processAccept, processUndo, processCreate } from './activities.js';
import { deliverActivity, collectInboxes } from './delivery.js';
import { validateExternalUrl } from '../security/ssrf.js';
import { userExists } from '../users.js';
import { getUserConfig } from '../config.js';

/**
 * Handle POST /{user}/inbox (Server-to-Server)
 */
export async function handleInbox(reqCtx) {
  const { request, params, config, env, ctx } = reqCtx;
  let username = params.user;

  // Shared inbox (/inbox): resolve target user from the activity body
  if (!username) {
    try {
      const body = await request.clone().json();
      const prefix = config.baseUrl + '/';
      // Try object (Follow target), then to/cc recipients
      const candidates = [
        typeof body.object === 'string' ? body.object : body.object?.id,
        ...[].concat(body.to || [], body.cc || []).map(r => typeof r === 'string' ? r : r?.id),
      ];
      for (const uri of candidates) {
        if (uri?.startsWith(prefix)) {
          const candidate = uri.slice(prefix.length).split('/')[0];
          if (candidate && await userExists(env.APPDATA, candidate)) {
            username = candidate;
            break;
          }
        }
      }
    } catch {}
  }

  if (!username || !await userExists(env.APPDATA, username)) {
    return new Response('Not Found', { status: 404 });
  }

  const uc = getUserConfig(config, username);

  // Parse activity
  let activity;
  try {
    activity = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!activity.type || !activity.actor) {
    console.log(`[inbox] rejected: missing type or actor`);
    return new Response('Missing type or actor', { status: 400 });
  }

  // Reject activities missing an id field (Accept/Reject may omit it)
  if (!activity.id && !['Accept', 'Reject'].includes(activity.type)) {
    console.log(`[inbox] rejected: missing activity id (type=${activity.type})`);
    return new Response('Missing activity id', { status: 400 });
  }

  // SSRF protection: validate actor URI
  const actorUri = typeof activity.actor === 'string' ? activity.actor : activity.actor.id;
  if (!validateExternalUrl(actorUri)) {
    console.log(`[inbox] rejected: SSRF blocked actor URI ${actorUri}`);
    return new Response('Invalid actor URI', { status: 400 });
  }

  // Fetch remote actor for signature verification
  const remoteActor = await fetchRemoteActor(actorUri, env.APPDATA);
  if (!remoteActor) {
    return new Response('Cannot fetch actor', { status: 400 });
  }

  // Verify HTTP Signature — require it (reject if actor has no public key)
  const publicPem = getActorPublicKey(remoteActor);
  if (!publicPem) {
    console.log(`[inbox] rejected: actor has no publicKey (${actorUri})`);
    return new Response('Actor has no public key for signature verification', { status: 401 });
  }

  const valid = await verifyRequestSignature(request, publicPem);
  if (!valid) {
    console.log(`[inbox] rejected: invalid HTTP Signature from ${actorUri}`);
    return new Response('Invalid signature', { status: 401 });
  }

  // Build a user-scoped config for activity processing
  const userScopedConfig = { ...config, ...uc };

  // Dispatch by activity type
  const type = activity.type;
  try {
    switch (type) {
      case 'Follow': {
        // Store as pending — owner accepts/rejects via the UI
        await processFollow(activity, userScopedConfig, env, ctx);
        break;
      }
      case 'Accept':
        await processAccept(activity, userScopedConfig, env);
        break;
      case 'Undo':
        await processUndo(activity, userScopedConfig, env);
        break;
      case 'Create':
        await processCreate(activity, userScopedConfig, env);
        break;
      default:
        // Store unknown activity types in inbox anyway
        await processCreate(activity, userScopedConfig, env);
    }
  } catch (err) {
    console.error('Inbox processing error:', err);
    return new Response('Internal Server Error', { status: 500 });
  }

  return new Response('Accepted', { status: 202 });
}
