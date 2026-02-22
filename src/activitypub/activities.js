/**
 * Activity processors: Follow, Accept, Undo, Create.
 */
import { simpleHash } from '../utils.js';

const AS_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public';

/**
 * Process an incoming Follow activity.
 * Stores as pending — the owner must accept or reject via the UI.
 */
export async function processFollow(activity, config, env, ctx) {
  const username = config.username;
  const followerUri = typeof activity.actor === 'string' ? activity.actor : activity.actor?.id || '';

  // Store in inbox
  await storeInboxActivity(activity, username, env);

  // Add to pending follow requests
  const pendingData = await env.APPDATA.get(`ap_pending_follows:${username}`);
  const pending = JSON.parse(pendingData || '[]');
  // Avoid duplicates
  if (!pending.some(p => p.actor === followerUri)) {
    pending.push({
      actor: followerUri,
      activityId: activity.id,
      receivedAt: new Date().toISOString(),
    });
    await env.APPDATA.put(`ap_pending_follows:${username}`, JSON.stringify(pending));
  }

  return { followerUri };
}

/**
 * Accept a pending follow request: add to followers, deliver Accept.
 */
export async function acceptFollowRequest(followerUri, config, env) {
  const username = config.username;

  // Find and remove from pending
  const pendingData = await env.APPDATA.get(`ap_pending_follows:${username}`);
  const pending = JSON.parse(pendingData || '[]');
  const entry = pending.find(p => p.actor === followerUri);
  const filtered = pending.filter(p => p.actor !== followerUri);
  await env.APPDATA.put(`ap_pending_follows:${username}`, JSON.stringify(filtered));

  // Add to followers list
  const followersData = await env.APPDATA.get(`ap_followers:${username}`);
  const followers = JSON.parse(followersData || '[]');
  if (!followers.includes(followerUri)) {
    followers.push(followerUri);
    await env.APPDATA.put(`ap_followers:${username}`, JSON.stringify(followers));
  }

  // Build Accept activity
  const accept = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Accept',
    id: `${config.baseUrl}/${username}/outbox/${crypto.randomUUID()}`,
    actor: config.actorId,
    object: {
      type: 'Follow',
      actor: followerUri,
      object: config.actorId,
      ...(entry?.activityId ? { id: entry.activityId } : {}),
    },
    published: new Date().toISOString(),
  };

  await storeOutboxActivity(accept, username, env);
  return accept;
}

/**
 * Reject a pending follow request: remove from pending, deliver Reject.
 */
export async function rejectFollowRequest(followerUri, config, env) {
  const username = config.username;

  // Remove from pending
  const pendingData = await env.APPDATA.get(`ap_pending_follows:${username}`);
  const pending = JSON.parse(pendingData || '[]');
  const entry = pending.find(p => p.actor === followerUri);
  const filtered = pending.filter(p => p.actor !== followerUri);
  await env.APPDATA.put(`ap_pending_follows:${username}`, JSON.stringify(filtered));

  // Build Reject activity
  const reject = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Reject',
    id: `${config.baseUrl}/${username}/outbox/${crypto.randomUUID()}`,
    actor: config.actorId,
    object: {
      type: 'Follow',
      actor: followerUri,
      object: config.actorId,
      ...(entry?.activityId ? { id: entry.activityId } : {}),
    },
    published: new Date().toISOString(),
  };

  await storeOutboxActivity(reject, username, env);
  return reject;
}

/**
 * Process an incoming Accept activity.
 */
export async function processAccept(activity, config, env) {
  const username = config.username;

  // If this accepts our Follow, add to following
  const inner = activity.object;
  if (inner && (inner.type === 'Follow' || inner === 'Follow')) {
    const targetActor = activity.actor;
    const followingData = await env.APPDATA.get(`ap_following:${username}`);
    const following = JSON.parse(followingData || '[]');
    if (!following.includes(targetActor)) {
      following.push(targetActor);
      await env.APPDATA.put(`ap_following:${username}`, JSON.stringify(following));
    }
  }

  await storeInboxActivity(activity, username, env);
}

/**
 * Process an incoming Undo activity.
 */
export async function processUndo(activity, config, env) {
  const username = config.username;
  const inner = activity.object;

  // If Undo(Follow), remove from followers
  if (inner && (inner.type === 'Follow' || (typeof inner === 'object' && inner.type === 'Follow'))) {
    const unfollowerUri = activity.actor;
    const followersData = await env.APPDATA.get(`ap_followers:${username}`);
    const followers = JSON.parse(followersData || '[]');
    const idx = followers.indexOf(unfollowerUri);
    if (idx >= 0) {
      followers.splice(idx, 1);
      await env.APPDATA.put(`ap_followers:${username}`, JSON.stringify(followers));
    }
  }

  await storeInboxActivity(activity, username, env);
}

/**
 * Process an incoming Create activity.
 */
export async function processCreate(activity, config, env) {
  await storeInboxActivity(activity, config.username, env);
}

/**
 * Create a Note activity for the outbox.
 */
export function buildCreateNote(config, content, summary, audience) {
  const username = config.username;
  const activityId = `${config.baseUrl}/${username}/outbox/${crypto.randomUUID()}`;
  const noteId = `${config.baseUrl}/${username}/posts/${crypto.randomUUID()}`;
  const published = new Date().toISOString();
  const followersUrl = `${config.baseUrl}/${username}/followers`;

  let to, cc;
  switch (audience) {
    case 'unlisted':
      to = [followersUrl];
      cc = [AS_PUBLIC];
      break;
    case 'followers':
      to = [followersUrl];
      cc = [];
      break;
    case 'private':
      to = [];
      cc = [];
      break;
    default: // public
      to = [AS_PUBLIC];
      cc = [followersUrl];
  }

  const note = {
    type: 'Note',
    id: noteId,
    attributedTo: config.actorId,
    content,
    published,
    to,
    cc,
  };
  if (summary) note.summary = summary;

  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Create',
    id: activityId,
    actor: config.actorId,
    object: note,
    to,
    cc,
    published,
  };
}

/**
 * Build a Follow activity.
 */
export function buildFollow(config, targetActorUri) {
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Follow',
    id: `${config.baseUrl}/${config.username}/outbox/${crypto.randomUUID()}`,
    actor: config.actorId,
    object: targetActorUri,
    published: new Date().toISOString(),
  };
}

/**
 * Build an Undo(Follow) activity.
 */
export function buildUnfollow(config, targetActorUri) {
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Undo',
    id: `${config.baseUrl}/${config.username}/outbox/${crypto.randomUUID()}`,
    actor: config.actorId,
    object: {
      type: 'Follow',
      actor: config.actorId,
      object: targetActorUri,
    },
    published: new Date().toISOString(),
  };
}

// --- Storage helpers ---

async function storeInboxActivity(activity, username, env) {
  const id = activity.id || crypto.randomUUID();
  const hash = simpleHash(id);
  await env.APPDATA.put(`ap_inbox_item:${hash}`, JSON.stringify(activity));

  const indexData = await env.APPDATA.get(`ap_inbox_index:${username}`);
  const index = JSON.parse(indexData || '[]');
  index.unshift({ id, published: activity.published || new Date().toISOString() });
  // Keep last 500 items
  if (index.length > 500) index.length = 500;
  await env.APPDATA.put(`ap_inbox_index:${username}`, JSON.stringify(index));
}

export async function storeOutboxActivity(activity, username, env) {
  const id = activity.id || crypto.randomUUID();
  const hash = simpleHash(id);
  await env.APPDATA.put(`ap_outbox_item:${hash}`, JSON.stringify(activity));

  const indexData = await env.APPDATA.get(`ap_outbox_index:${username}`);
  const index = JSON.parse(indexData || '[]');
  index.unshift({ id, published: activity.published || new Date().toISOString() });
  if (index.length > 500) index.length = 500;
  await env.APPDATA.put(`ap_outbox_index:${username}`, JSON.stringify(index));
}

