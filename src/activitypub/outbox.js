/**
 * Outbox collection and C2S activity creation.
 */
import { requireAuth } from '../auth/middleware.js';
import { buildCreateNote, buildFollow, buildUnfollow, storeOutboxActivity, storeInboxActivity, acceptFollowRequest, rejectFollowRequest } from './activities.js';
import { deliverActivity, collectInboxes } from './delivery.js';
import { resolveHandle, fetchRemoteActor, getActorInbox } from './remote.js';
import { simpleHash } from '../utils.js';
import { userExists } from '../users.js';
import { getUserConfig } from '../config.js';

const PAGE_SIZE = 20;

/**
 * Handle GET /{user}/outbox — OrderedCollection (paginated)
 */
export async function handleOutbox(reqCtx) {
  const { url, params, config, env } = reqCtx;
  const username = params.user;

  if (!await userExists(env.APPDATA, username)) {
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
 * Detect if a follow/unfollow target refers to a local user.
 * Returns the local username or null.
 */
function resolveLocalUser(target, config) {
  // bare username or @username (no domain part)
  const bare = target.match(/^@?([a-zA-Z0-9_-]+)$/);
  if (bare) return bare[1];
  // @username@domain where domain is ours
  const full = target.match(/^@?([^@]+)@(.+)$/);
  if (full && full[2] === config.domain) return full[1];
  // Full actor URI on this server
  if (target.startsWith(config.baseUrl + '/')) {
    const parts = target.slice(config.baseUrl.length + 1).split('/');
    if (parts[1] === 'profile' && parts[2]?.startsWith('card')) return parts[0];
  }
  return null;
}

/**
 * Handle POST /compose — Create a Note
 */
export async function handleCompose(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { request, config, env, ctx } = reqCtx;
  const username = reqCtx.user;
  const uc = getUserConfig(config, username);
  const userScopedConfig = { ...config, ...uc };

  const form = await request.formData();
  const content = form.get('content');
  if (!content) {
    return new Response(null, { status: 302, headers: { 'Location': '/activity?error=empty' } });
  }
  const summary = form.get('summary') || '';
  const audience = form.get('audience') || 'public';

  const activity = buildCreateNote(userScopedConfig, content, summary, audience);
  await storeOutboxActivity(activity, username, env);

  // Deliver to followers
  if (audience !== 'private') {
    const followersData = await env.APPDATA.get(`ap_followers:${username}`);
    const followers = JSON.parse(followersData || '[]');
    if (followers.length > 0) {
      // Separate local and remote followers
      const remoteFollowers = [];
      for (const followerUri of followers) {
        const localUser = resolveLocalUser(followerUri, config);
        if (localUser && await userExists(env.APPDATA, localUser)) {
          // Deliver directly to local user's inbox via KV
          await storeInboxActivity(activity, localUser, env);
        } else {
          remoteFollowers.push(followerUri);
        }
      }

      // Deliver to remote followers via HTTP
      if (remoteFollowers.length > 0) {
        const privatePem = await env.APPDATA.get(`ap_private_key:${username}`);
        const inboxUrls = await collectInboxes(remoteFollowers, env.APPDATA);
        deliverActivity({
          activityJson: JSON.stringify(activity),
          inboxUrls,
          keyId: uc.keyId,
          privatePem,
          ctx,
        });
      }
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
  const username = reqCtx.user;
  const uc = getUserConfig(config, username);
  const userScopedConfig = { ...config, ...uc };

  const form = await request.formData();
  const target = form.get('target');
  if (!target) {
    return new Response(null, { status: 302, headers: { 'Location': '/activity?error=no_target' } });
  }

  // Check if this is a local user
  const localTarget = resolveLocalUser(target, config);
  if (localTarget && await userExists(env.APPDATA, localTarget)) {
    return handleLocalFollow(username, localTarget, config, env, uc);
  }

  // Remote follow
  let actorUri = target;
  if (target.includes('@') && !target.startsWith('http')) {
    actorUri = await resolveHandle(target);
    if (!actorUri) {
      return new Response(null, { status: 302, headers: { 'Location': '/activity?error=not_found' } });
    }
  }

  const activity = buildFollow(userScopedConfig, actorUri);
  await storeOutboxActivity(activity, username, env);

  // Deliver Follow to target
  const remoteActor = await fetchRemoteActor(actorUri, env.APPDATA);
  if (remoteActor) {
    const inboxUrl = getActorInbox(remoteActor);
    if (inboxUrl) {
      const privatePem = await env.APPDATA.get(`ap_private_key:${username}`);
      deliverActivity({
        activityJson: JSON.stringify(activity),
        inboxUrls: [inboxUrl],
        keyId: uc.keyId,
        privatePem,
        ctx,
      });
    }
  }

  return new Response(null, { status: 302, headers: { 'Location': '/activity' } });
}

/**
 * Handle a local follow — both users are on this server.
 */
async function handleLocalFollow(followerUsername, targetUsername, config, env, followerUc) {
  const targetUc = getUserConfig(config, targetUsername);

  // Build a Follow activity
  const activity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Follow',
    id: `${config.baseUrl}/${followerUsername}/outbox/${Date.now()}`,
    actor: followerUc.actorId,
    object: targetUc.actorId,
    published: new Date().toISOString(),
  };

  // Store in follower's outbox
  await storeOutboxActivity(activity, followerUsername, env);

  // Store in target's inbox
  await storeInboxActivity(activity, targetUsername, env);

  // Add to target's pending follows
  const pendingData = await env.APPDATA.get(`ap_pending_follows:${targetUsername}`);
  const pending = JSON.parse(pendingData || '[]');
  if (!pending.some(p => p.actor === followerUc.actorId)) {
    pending.push({
      actor: followerUc.actorId,
      receivedAt: new Date().toISOString(),
    });
    await env.APPDATA.put(`ap_pending_follows:${targetUsername}`, JSON.stringify(pending));
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
  const username = reqCtx.user;
  const uc = getUserConfig(config, username);
  const userScopedConfig = { ...config, ...uc };

  const form = await request.formData();
  const target = form.get('target');
  if (!target) {
    return new Response(null, { status: 302, headers: { 'Location': '/activity?error=no_target' } });
  }

  // Check if this is a local user
  const localTarget = resolveLocalUser(target, config);
  if (localTarget && await userExists(env.APPDATA, localTarget)) {
    return handleLocalUnfollow(username, localTarget, target, config, env, uc);
  }

  // Remove from following
  const followingData = await env.APPDATA.get(`ap_following:${username}`);
  const following = JSON.parse(followingData || '[]');
  const idx = following.indexOf(target);
  if (idx >= 0) {
    following.splice(idx, 1);
    await env.APPDATA.put(`ap_following:${username}`, JSON.stringify(following));
  }

  const activity = buildUnfollow(userScopedConfig, target);
  await storeOutboxActivity(activity, username, env);

  // Deliver Undo(Follow) to target
  const remoteActor = await fetchRemoteActor(target, env.APPDATA);
  if (remoteActor) {
    const inboxUrl = getActorInbox(remoteActor);
    if (inboxUrl) {
      const privatePem = await env.APPDATA.get(`ap_private_key:${username}`);
      deliverActivity({
        activityJson: JSON.stringify(activity),
        inboxUrls: [inboxUrl],
        keyId: uc.keyId,
        privatePem,
        ctx,
      });
    }
  }

  return new Response(null, { status: 302, headers: { 'Location': '/activity' } });
}

/**
 * Handle a local unfollow — both users are on this server.
 */
async function handleLocalUnfollow(followerUsername, targetUsername, targetActorUri, config, env, followerUc) {
  const targetUc = getUserConfig(config, targetUsername);
  const actorUri = targetActorUri.startsWith('http') ? targetActorUri : targetUc.actorId;

  // Remove from follower's following list
  const followingData = await env.APPDATA.get(`ap_following:${followerUsername}`);
  const following = JSON.parse(followingData || '[]');
  const filtered = following.filter(f => f !== actorUri);
  await env.APPDATA.put(`ap_following:${followerUsername}`, JSON.stringify(filtered));

  // Remove from target's followers list
  const followersData = await env.APPDATA.get(`ap_followers:${targetUsername}`);
  const followers = JSON.parse(followersData || '[]');
  const filteredFollowers = followers.filter(f => f !== followerUc.actorId);
  await env.APPDATA.put(`ap_followers:${targetUsername}`, JSON.stringify(filteredFollowers));

  // Build and store Undo activity
  const activity = buildUnfollow({ ...config, ...followerUc }, actorUri);
  await storeOutboxActivity(activity, followerUsername, env);
  await storeInboxActivity(activity, targetUsername, env);

  return new Response(null, { status: 302, headers: { 'Location': '/activity' } });
}

/**
 * Handle POST /follow-requests/accept
 */
export async function handleAcceptFollowRequest(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { request, config, env, ctx } = reqCtx;
  const username = reqCtx.user;
  const uc = getUserConfig(config, username);
  const userScopedConfig = { ...config, ...uc };

  const form = await request.formData();
  const target = form.get('target');
  if (!target) {
    return new Response(null, { status: 302, headers: { 'Location': '/activity' } });
  }

  const accept = await acceptFollowRequest(target, userScopedConfig, env);

  // Check if the follower is a local user
  const localFollower = resolveLocalUser(target, config);
  if (localFollower && await userExists(env.APPDATA, localFollower)) {
    // Local accept: directly update the follower's following list
    const followerUc = getUserConfig(config, localFollower);
    const followingData = await env.APPDATA.get(`ap_following:${localFollower}`);
    const following = JSON.parse(followingData || '[]');
    if (!following.includes(uc.actorId)) {
      following.push(uc.actorId);
      await env.APPDATA.put(`ap_following:${localFollower}`, JSON.stringify(following));
    }
    // Store Accept activity in both users' data
    await storeOutboxActivity(accept, username, env);
    await storeInboxActivity(accept, localFollower, env);
  } else {
    // Deliver Accept to the remote follower
    const remoteActor = await fetchRemoteActor(target, env.APPDATA);
    if (remoteActor) {
      const inboxUrl = getActorInbox(remoteActor);
      if (inboxUrl) {
        const privatePem = await env.APPDATA.get(`ap_private_key:${username}`);
        deliverActivity({
          activityJson: JSON.stringify(accept),
          inboxUrls: [inboxUrl],
          keyId: uc.keyId,
          privatePem,
          ctx,
        });
      }
    }
  }

  return new Response(null, { status: 302, headers: { 'Location': '/activity' } });
}

/**
 * Handle POST /follow-requests/reject
 */
export async function handleRejectFollowRequest(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { request, config, env, ctx } = reqCtx;
  const username = reqCtx.user;
  const uc = getUserConfig(config, username);
  const userScopedConfig = { ...config, ...uc };

  const form = await request.formData();
  const target = form.get('target');
  if (!target) {
    return new Response(null, { status: 302, headers: { 'Location': '/activity' } });
  }

  const reject = await rejectFollowRequest(target, userScopedConfig, env);

  // Check if the follower is a local user
  const localFollower = resolveLocalUser(target, config);
  if (localFollower && await userExists(env.APPDATA, localFollower)) {
    // Store Reject in both users' data
    await storeOutboxActivity(reject, username, env);
    await storeInboxActivity(reject, localFollower, env);
  } else {
    // Deliver Reject to the remote follower
    const remoteActor = await fetchRemoteActor(target, env.APPDATA);
    if (remoteActor) {
      const inboxUrl = getActorInbox(remoteActor);
      if (inboxUrl) {
        const privatePem = await env.APPDATA.get(`ap_private_key:${username}`);
        deliverActivity({
          activityJson: JSON.stringify(reject),
          inboxUrls: [inboxUrl],
          keyId: uc.keyId,
          privatePem,
          ctx,
        });
      }
    }
  }

  return new Response(null, { status: 302, headers: { 'Location': '/activity' } });
}

/**
 * Handle POST /{user}/outbox — Client-to-Server activity submission.
 *
 * Accepts an AS2 JSON activity from the authenticated resource owner.
 * Stores the activity in the user's outbox (and inbox for self-visibility).
 * For public activities, delivers to followers.
 *
 * Supported activity types: Like, Read, View, Question, Create, Follow, Announce.
 * For Follow and Create(Note), prefer the dedicated /follow and /compose endpoints
 * which handle additional side-effects (pending follow requests, etc.).
 */
export async function handleOutboxPost(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { request, config, env, ctx, params } = reqCtx;
  const username = reqCtx.user;

  // Ensure the authenticated user matches the outbox owner
  if (params.user && params.user !== username) {
    return new Response('Forbidden', { status: 403 });
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('json')) {
    return new Response('Content-Type must be application/activity+json or application/ld+json', { status: 415 });
  }

  let activity;
  try {
    activity = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!activity.type) {
    return new Response('Activity must have a type', { status: 400 });
  }

  const uc = getUserConfig(config, username);

  // Ensure the activity has required fields
  if (!activity.id) {
    activity.id = `${config.baseUrl}/${username}/outbox/${crypto.randomUUID()}`;
  }
  if (!activity.actor) {
    activity.actor = uc.actorId;
  }
  if (!activity.published) {
    activity.published = new Date().toISOString();
  }
  if (!activity['@context']) {
    activity['@context'] = 'https://www.w3.org/ns/activitystreams';
  }

  // Store in outbox
  await storeOutboxActivity(activity, username, env);

  // Store in own inbox so the user sees it in their feed
  await storeInboxActivity(activity, username, env);

  // Deliver to followers if the activity is public
  const AS_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public';
  const to = Array.isArray(activity.to) ? activity.to : (activity.to ? [activity.to] : []);
  const cc = Array.isArray(activity.cc) ? activity.cc : (activity.cc ? [activity.cc] : []);
  const isPublic = to.includes(AS_PUBLIC) || cc.includes(AS_PUBLIC);

  if (isPublic) {
    const followersData = await env.APPDATA.get(`ap_followers:${username}`);
    const followers = JSON.parse(followersData || '[]');
    if (followers.length > 0) {
      const remoteFollowers = [];
      for (const followerUri of followers) {
        const localUser = resolveLocalUser(followerUri, config);
        if (localUser && await userExists(env.APPDATA, localUser)) {
          await storeInboxActivity(activity, localUser, env);
        } else {
          remoteFollowers.push(followerUri);
        }
      }

      if (remoteFollowers.length > 0) {
        const privatePem = await env.APPDATA.get(`ap_private_key:${username}`);
        const inboxUrls = await collectInboxes(remoteFollowers, env.APPDATA);
        deliverActivity({
          activityJson: JSON.stringify(activity),
          inboxUrls,
          keyId: uc.keyId,
          privatePem,
          ctx,
        });
      }
    }
  }

  return new Response(JSON.stringify(activity), {
    status: 201,
    headers: {
      'Content-Type': 'application/activity+json',
      'Location': activity.id,
    },
  });
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'Content-Type': 'application/activity+json' },
  });
}
