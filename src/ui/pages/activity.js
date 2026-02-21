/**
 * Activity feed page: compose, follow/unfollow, feed.
 */
import { renderPage } from '../shell.js';
import template from '../templates/activity.html';
import { requireAuth } from '../../auth/middleware.js';

export async function renderActivityPage(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env, url } = reqCtx;
  const username = config.username;
  const error = url.searchParams.get('error');

  // Load inbox and outbox
  const [inboxData, outboxData, followingData] = await Promise.all([
    env.APPDATA.get(`ap_inbox_index:${username}`),
    env.APPDATA.get(`ap_outbox_index:${username}`),
    env.APPDATA.get(`ap_following:${username}`),
  ]);

  const inboxIndex = JSON.parse(inboxData || '[]').slice(0, 20);
  const outboxIndex = JSON.parse(outboxData || '[]').slice(0, 20);
  const following = JSON.parse(followingData || '[]');

  // Fetch activity items
  const inboxItems = await fetchItems(inboxIndex, 'ap_inbox_item:', env);
  const outboxItems = await fetchItems(outboxIndex, 'ap_outbox_item:', env);

  // Merge and sort by published date
  const allItems = [
    ...inboxItems.map(a => ({ ...a, _source: 'inbox' })),
    ...outboxItems.map(a => ({ ...a, _source: 'outbox' })),
  ].sort((a, b) => (b.published || '').localeCompare(a.published || ''));

  // Pre-process activities with boolean flags for Mustache
  const activities = allItems.map(a => {
    const source = a._source === 'inbox' ? 'Received' : 'Sent';
    const type = a.type || 'Unknown';
    const actor = typeof a.actor === 'string' ? a.actor : a.actor?.id || '';
    const published = a.published ? new Date(a.published).toLocaleString() : '';
    const sourceColor = source === 'Received' ? '#d4edda' : '#cce5ff';

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

    return { source, type, actor, published, sourceColor, isCreate, isFollow, isAccept, isUndo, isOther, content, summary, hasSummary, target };
  });

  return renderPage('Activity', template, {
    error,
    following,
    hasFollowing: following.length > 0,
    followingCount: following.length,
    activities,
    hasActivities: activities.length > 0,
  }, { user: username, nav: 'activity' });
}

async function fetchItems(index, prefix, env) {
  const items = [];
  for (const entry of index) {
    const hash = simpleHash(entry.id);
    const data = await env.APPDATA.get(`${prefix}${hash}`);
    if (data) items.push(JSON.parse(data));
  }
  return items;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
