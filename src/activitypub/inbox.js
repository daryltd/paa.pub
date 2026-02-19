/**
 * S2S inbox handler: verify HTTP Signature, dispatch by activity type.
 */
import { verifyRequestSignature, extractKeyId } from './httpsig.js';
import { fetchRemoteActor, getActorPublicKey } from './remote.js';
import { processFollow, processAccept, processUndo, processCreate } from './activities.js';
import { deliverActivity, collectInboxes } from './delivery.js';

/**
 * Handle POST /{user}/inbox (Server-to-Server)
 */
export async function handleInbox(reqCtx) {
  const { request, params, config, env, ctx } = reqCtx;
  const username = params.user;

  if (username !== config.username) {
    return new Response('Not Found', { status: 404 });
  }

  // Parse activity
  let activity;
  try {
    activity = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!activity.type || !activity.actor) {
    return new Response('Missing type or actor', { status: 400 });
  }

  // Fetch remote actor for signature verification
  const actorUri = typeof activity.actor === 'string' ? activity.actor : activity.actor.id;
  const remoteActor = await fetchRemoteActor(actorUri, env.APPDATA);
  if (!remoteActor) {
    return new Response('Cannot fetch actor', { status: 400 });
  }

  // Verify HTTP Signature
  const publicPem = getActorPublicKey(remoteActor);
  if (publicPem) {
    const valid = await verifyRequestSignature(request, publicPem);
    if (!valid) {
      return new Response('Invalid signature', { status: 401 });
    }
  }

  // Dispatch by activity type
  const type = activity.type;
  try {
    switch (type) {
      case 'Follow': {
        const { accept, followerUri } = await processFollow(activity, config, env, ctx);
        // Deliver Accept back to the follower
        const privatePem = await env.APPDATA.get(`ap_private_key:${username}`);
        const inboxUrl = remoteActor.inbox;
        if (inboxUrl && privatePem) {
          deliverActivity({
            activityJson: JSON.stringify(accept),
            inboxUrls: [inboxUrl],
            keyId: config.keyId,
            privatePem,
            ctx,
          });
        }
        break;
      }
      case 'Accept':
        await processAccept(activity, config, env);
        break;
      case 'Undo':
        await processUndo(activity, config, env);
        break;
      case 'Create':
        await processCreate(activity, config, env);
        break;
      default:
        // Store unknown activity types in inbox anyway
        await processCreate(activity, config, env);
    }
  } catch (err) {
    console.error('Inbox processing error:', err);
    return new Response('Internal Server Error', { status: 500 });
  }

  return new Response('Accepted', { status: 202 });
}
