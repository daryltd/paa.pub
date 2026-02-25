/**
 * Activity feed page: compose, follow/unfollow, pending follow requests, feed.
 *
 * Routes:
 *   GET /activity         — main activity feed (own inbox + outbox)
 *   GET /activity/remote  — view a remote actor's recent public posts
 */
import { renderPage } from '../shell.js';
import template from '../templates/activity.html';
import { requireAuth } from '../../auth/middleware.js';
import { simpleHash } from '../../utils.js';
import { fetchRemoteActor } from '../../activitypub/remote.js';

export async function renderActivityPage(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env, url } = reqCtx;
  const username = config.username;
  const error = url.searchParams.get('error');
  const feedLimit = config.feedLimit;

  // Load inbox, outbox, following, and pending follow requests
  const [inboxData, outboxData, followingData, pendingData, followersData, watermark, readItemsData] = await Promise.all([
    env.APPDATA.get(`ap_inbox_index:${username}`),
    env.APPDATA.get(`ap_outbox_index:${username}`),
    env.APPDATA.get(`ap_following:${username}`),
    env.APPDATA.get(`ap_pending_follows:${username}`),
    env.APPDATA.get(`ap_followers:${username}`),
    env.APPDATA.get(`ap_read_watermark:${username}`),
    env.APPDATA.get(`ap_read_items:${username}`),
  ]);

  const readSet = new Set(JSON.parse(readItemsData || '[]'));

  const inboxIndex = JSON.parse(inboxData || '[]').slice(0, feedLimit);
  const outboxIndex = JSON.parse(outboxData || '[]').slice(0, feedLimit);
  const following = JSON.parse(followingData || '[]');
  const followers = JSON.parse(followersData || '[]');
  const pendingFollows = JSON.parse(pendingData || '[]');

  // Fetch activity items
  const inboxItems = await fetchItems(inboxIndex, 'ap_inbox_item:', env);
  const outboxItems = await fetchItems(outboxIndex, 'ap_outbox_item:', env);

  // Merge and sort by published date, then limit
  let allItems = [
    ...inboxItems.map(a => ({ ...a, _source: 'inbox' })),
    ...outboxItems.map(a => ({ ...a, _source: 'outbox' })),
  ].sort((a, b) => (b.published || '').localeCompare(a.published || ''))
   .slice(0, feedLimit);

  // Filter out read items unless ?show=all
  const showAll = url.searchParams.get('show') === 'all';
  if (!showAll) {
    allItems = allItems.filter(a => {
      if (watermark && a.published && a.published <= watermark) return false;
      if (readSet.has(a.id)) return false;
      return true;
    });
  }

  // Pre-process activities with boolean flags for Mustache
  const activities = allItems.map(a => {
    const source = a._source === 'inbox' ? 'Received' : 'Sent';
    const type = a.type || 'Unknown';
    const actor = typeof a.actor === 'string' ? a.actor : a.actor?.id || '';
    const published = a.published ? new Date(a.published).toLocaleString() : '';
    const isReceived = source === 'Received';

    let isCreate = false, isFollow = false, isAccept = false, isUndo = false, isOther = false;
    let content = '', summary = '', hasSummary = false, target = '';

    if (type === 'Create' && a.object && typeof a.object !== 'string') {
      isCreate = true;
      content = a.object.content || '';
      summary = a.object.summary || '';
      hasSummary = !!summary;
    } else if (type === 'Follow') {
      isFollow = true;
      target = typeof a.object === 'string' ? a.object : a.object?.id || '';
    } else if (type === 'Accept') {
      isAccept = true;
    } else if (type === 'Undo') {
      isUndo = true;
    } else {
      isOther = true;
    }

    return { activityId: a.id, source, type, actor, published, isReceived, isCreate, isFollow, isAccept, isUndo, isOther, content, summary, hasSummary, target };
  });

  // Format pending follow requests for template
  const pendingRequests = pendingFollows.map(p => ({
    actor: p.actor,
    receivedAt: p.receivedAt ? new Date(p.receivedAt).toLocaleString() : '',
  }));

  // Format followers and following with profile feed links
  const followingList = following.map(uri => ({
    uri,
    feedUrl: `/activity/remote?actor=${encodeURIComponent(uri)}`,
  }));
  const followersList = followers.map(uri => ({
    uri,
    feedUrl: `/activity/remote?actor=${encodeURIComponent(uri)}`,
  }));

  return renderPage('Activity', template, {
    error,
    following: followingList,
    hasFollowing: followingList.length > 0,
    followingCount: followingList.length,
    followers: followersList,
    hasFollowers: followersList.length > 0,
    followerCount: followersList.length,
    pendingRequests,
    hasPendingRequests: pendingRequests.length > 0,
    pendingCount: pendingRequests.length,
    activities,
    hasActivities: activities.length > 0,
    feedLimit,
    showAll,
  }, { user: username, nav: 'activity', storage: reqCtx.storage, baseUrl: config.baseUrl });
}

/**
 * Render a remote actor's public feed.
 * GET /activity/remote?actor=<uri>
 */
export async function renderRemoteFeed(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env, url } = reqCtx;
  const actorUri = url.searchParams.get('actor');
  if (!actorUri) {
    return new Response(null, { status: 302, headers: { 'Location': '/activity' } });
  }

  const feedLimit = config.feedLimit;

  // Fetch the remote actor to get their outbox URL
  const actor = await fetchRemoteActor(actorUri, env.APPDATA);
  if (!actor || !actor.outbox) {
    return renderPage('Remote Feed', '<h1>Remote Feed</h1><div class="card"><div class="text-muted">Could not load actor or outbox.</div><a href="/activity" class="btn mt-05">Back</a></div>', {}, { user: config.username, nav: 'activity', storage: reqCtx.storage, baseUrl: config.baseUrl });
  }

  // Fetch the outbox collection
  let items = [];
  try {
    const outboxRes = await fetch(actor.outbox, {
      headers: { 'Accept': 'application/activity+json, application/ld+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (outboxRes.ok) {
      const outbox = await outboxRes.json();
      // If it has orderedItems directly, use them
      if (outbox.orderedItems) {
        items = outbox.orderedItems.slice(0, feedLimit);
      } else if (outbox.first) {
        // Fetch the first page
        const firstUrl = typeof outbox.first === 'string' ? outbox.first : outbox.first.id || outbox.first;
        const pageRes = await fetch(firstUrl, {
          headers: { 'Accept': 'application/activity+json, application/ld+json' },
          signal: AbortSignal.timeout(10000),
        });
        if (pageRes.ok) {
          const page = await pageRes.json();
          items = (page.orderedItems || []).slice(0, feedLimit);
        }
      }
    }
  } catch (e) {
    console.error(`Failed to fetch remote outbox for ${actorUri}:`, e);
  }

  // Process items for display
  const activities = items.map(a => {
    const type = a.type || 'Unknown';
    const published = a.published ? new Date(a.published).toLocaleString() : '';
    let content = '', summary = '', hasSummary = false;
    const isCreate = type === 'Create' && a.object && typeof a.object !== 'string';

    if (isCreate) {
      content = a.object.content || '';
      summary = a.object.summary || '';
      hasSummary = !!summary;
    }

    return { type, published, isCreate, content, summary, hasSummary, isOther: !isCreate };
  });

  const actorName = actor.preferredUsername || actor.name || actorUri;

  const body = `<h1>Feed: ${escapeHtml(actorName)}</h1>
<div class="card">
  <div class="mono text-muted text-sm break-all mb-05">${escapeHtml(actorUri)}</div>
  <a href="/activity" class="btn btn-secondary">Back to Activity</a>
</div>
${activities.length === 0 ? '<div class="card text-muted">No public activities found.</div>' : ''}
${activities.map(a => `<div class="card">
  <div class="flex justify-between mb-05">
    <span class="badge badge-type">${escapeHtml(a.type)}</span>
    <span class="text-muted">${escapeHtml(a.published)}</span>
  </div>
  ${a.isCreate ? `${a.hasSummary ? `<div class="text-muted"><em>CW: ${escapeHtml(a.summary)}</em></div>` : ''}
  <div>${a.content}</div>` : `<div class="text-muted">${escapeHtml(a.type)} activity</div>`}
</div>`).join('\n')}`;

  return renderPage('Remote Feed', body, {}, { user: config.username, nav: 'activity', storage: reqCtx.storage, baseUrl: config.baseUrl });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function handleMarkRead(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env, request } = reqCtx;
  const username = config.username;
  const formData = await request.formData();
  const id = formData.get('id');

  if (id) {
    const existing = await env.APPDATA.get(`ap_read_items:${username}`);
    const readItems = JSON.parse(existing || '[]');
    if (!readItems.includes(id)) {
      readItems.push(id);
      await env.APPDATA.put(`ap_read_items:${username}`, JSON.stringify(readItems));
    }
  }

  return new Response(null, { status: 302, headers: { 'Location': '/activity' } });
}

export async function handleMarkAllRead(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env } = reqCtx;
  const username = config.username;

  await Promise.all([
    env.APPDATA.put(`ap_read_watermark:${username}`, new Date().toISOString()),
    env.APPDATA.put(`ap_read_items:${username}`, JSON.stringify([])),
  ]);

  return new Response(null, { status: 302, headers: { 'Location': '/activity' } });
}

async function fetchItems(index, prefix, env) {
  const results = await Promise.all(
    index.map(entry => env.APPDATA.get(`${prefix}${simpleHash(entry.id)}`))
  );
  return results.filter(Boolean).map(d => JSON.parse(d));
}
