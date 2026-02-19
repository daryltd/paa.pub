/**
 * Outbox collection and C2S activity creation.
 */
import { requireAuth } from '../auth/middleware.js';
import { buildCreateNote, buildFollow, buildUnfollow, storeOutboxActivity } from './activities.js';
import { deliverActivity, collectInboxes } from './delivery.js';
import { resolveHandle, fetchRemoteActor, getActorInbox } from './remote.js';

const PAGE_SIZE = 20;

/**
 * Handle GET /{user}/outbox — OrderedCollection (paginated)
 */
export async function handleOutbox(reqCtx) {
  const { url, params, config, env } = reqCtx;
  const username = params.user;

  if (username !== config.username) {
    return new Response('Not Found', { status: 404 });
  }

  const outboxUrl = `${config.baseUrl}/${username}/outbox`;
  const indexData = await env.APPDATA.get(`ap_outbox_index:${username}`);
  const index = JSON.parse(indexData || '[]');

  const page = url.searchParams.get('page');

  if (page === null) {
    // Return collection summary
    const collection = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'OrderedCollection',
      id: outboxUrl,
      totalItems: index.length,
    };
    if (index.length > 0) {
      collection.first = `${outboxUrl}?page=0`;
      collection.last = `${outboxUrl}?page=${Math.max(0, Math.ceil(index.length / PAGE_SIZE) - 1)}`;
    }
    return jsonResponse(collection);
  }

  // Return a page
  const pageNum = parseInt(page, 10);
  const start = pageNum * PAGE_SIZE;
  const pageItems = index.slice(start, start + PAGE_SIZE);

  const items = [];
  for (const entry of pageItems) {
    const hash = simpleHash(entry.id);
    const data = await env.APPDATA.get(`ap_outbox_item:${hash}`);
    if (data) items.push(JSON.parse(data));
  }

  const collectionPage = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'OrderedCollectionPage',
    id: `${outboxUrl}?page=${pageNum}`,
    partOf: outboxUrl,
    orderedItems: items,
  };
  if (start + PAGE_SIZE < index.length) {
    collectionPage.next = `${outboxUrl}?page=${pageNum + 1}`;
  }
  if (pageNum > 0) {
    collectionPage.prev = `${outboxUrl}?page=${pageNum - 1}`;
  }

  return jsonResponse(collectionPage);
}

/**
 * Handle POST /compose — Create a Note
 */
export async function handleCompose(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { request, config, env, ctx } = reqCtx;
  const form = await request.formData();
  const content = form.get('content');
  if (!content) {
    return new Response(null, { status: 302, headers: { 'Location': '/activity?error=empty' } });
  }
  const summary = form.get('summary') || '';
  const audience = form.get('audience') || 'public';

  const activity = buildCreateNote(config, content, summary, audience);
  await storeOutboxActivity(activity, config.username, env);

  // Deliver to followers
  if (audience !== 'private') {
    const followersData = await env.APPDATA.get(`ap_followers:${config.username}`);
    const followers = JSON.parse(followersData || '[]');
    if (followers.length > 0) {
      const privatePem = await env.APPDATA.get(`ap_private_key:${config.username}`);
      const inboxUrls = await collectInboxes(followers, env.APPDATA);
      deliverActivity({
        activityJson: JSON.stringify(activity),
        inboxUrls,
        keyId: config.keyId,
        privatePem,
        ctx,
      });
    }
  }

  return new Response(null, { status: 302, headers: { 'Location': '/activity' } });
}

/**
 * Handle POST /follow
 */
export async function handleFollow(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { request, config, env, ctx } = reqCtx;
  const form = await request.formData();
  const target = form.get('target');
  if (!target) {
    return new Response(null, { status: 302, headers: { 'Location': '/activity?error=no_target' } });
  }

  // Resolve handle if needed
  let actorUri = target;
  if (target.includes('@') && !target.startsWith('http')) {
    actorUri = await resolveHandle(target);
    if (!actorUri) {
      return new Response(null, { status: 302, headers: { 'Location': '/activity?error=not_found' } });
    }
  }

  const activity = buildFollow(config, actorUri);
  await storeOutboxActivity(activity, config.username, env);

  // Deliver Follow to target
  const remoteActor = await fetchRemoteActor(actorUri, env.APPDATA);
  if (remoteActor) {
    const inboxUrl = getActorInbox(remoteActor);
    if (inboxUrl) {
      const privatePem = await env.APPDATA.get(`ap_private_key:${config.username}`);
      deliverActivity({
        activityJson: JSON.stringify(activity),
        inboxUrls: [inboxUrl],
        keyId: config.keyId,
        privatePem,
        ctx,
      });
    }
  }

  return new Response(null, { status: 302, headers: { 'Location': '/activity' } });
}

/**
 * Handle POST /unfollow
 */
export async function handleUnfollow(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { request, config, env, ctx } = reqCtx;
  const form = await request.formData();
  const target = form.get('target');
  if (!target) {
    return new Response(null, { status: 302, headers: { 'Location': '/activity?error=no_target' } });
  }

  // Remove from following
  const followingData = await env.APPDATA.get(`ap_following:${config.username}`);
  const following = JSON.parse(followingData || '[]');
  const idx = following.indexOf(target);
  if (idx >= 0) {
    following.splice(idx, 1);
    await env.APPDATA.put(`ap_following:${config.username}`, JSON.stringify(following));
  }

  const activity = buildUnfollow(config, target);
  await storeOutboxActivity(activity, config.username, env);

  // Deliver Undo(Follow) to target
  const remoteActor = await fetchRemoteActor(target, env.APPDATA);
  if (remoteActor) {
    const inboxUrl = getActorInbox(remoteActor);
    if (inboxUrl) {
      const privatePem = await env.APPDATA.get(`ap_private_key:${config.username}`);
      deliverActivity({
        activityJson: JSON.stringify(activity),
        inboxUrls: [inboxUrl],
        keyId: config.keyId,
        privatePem,
        ctx,
      });
    }
  }

  return new Response(null, { status: 302, headers: { 'Location': '/activity' } });
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'Content-Type': 'application/activity+json' },
  });
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
