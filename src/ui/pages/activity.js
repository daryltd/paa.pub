/**
 * Activity feed page: compose, follow/unfollow, feed.
 */
import { htmlPage, htmlResponse, escapeHtml } from '../shell.js';
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

  const body = `
    <h1>Activity</h1>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}

    <div class="card">
      <h2>Compose</h2>
      <form method="POST" action="/compose">
        <div class="form-group">
          <textarea name="content" placeholder="What's on your mind?" required></textarea>
        </div>
        <div class="form-group">
          <label for="audience">Audience</label>
          <select name="audience" id="audience">
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="followers">Followers Only</option>
            <option value="private">Private</option>
          </select>
        </div>
        <div class="form-group">
          <input type="text" name="summary" placeholder="Content warning (optional)">
        </div>
        <button type="submit" class="btn">Post</button>
      </form>
    </div>

    <div class="card">
      <h2>Follow / Unfollow</h2>
      <form method="POST" action="/follow" style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem;">
        <input type="text" name="target" placeholder="user@domain.com or actor URL" style="flex: 1;">
        <button type="submit" class="btn">Follow</button>
      </form>
      ${following.length > 0 ? `
        <details>
          <summary class="text-muted">${following.length} following</summary>
          <ul style="list-style: none; padding: 0; margin-top: 0.5rem;">
            ${following.map(f => `
              <li style="display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0;">
                <span class="mono" style="flex: 1; font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(f)}</span>
                <form method="POST" action="/unfollow" class="inline">
                  <input type="hidden" name="target" value="${escapeHtml(f)}">
                  <button type="submit" class="btn btn-secondary" style="padding: 0.15rem 0.5rem; font-size: 0.75rem;">Unfollow</button>
                </form>
              </li>
            `).join('')}
          </ul>
        </details>
      ` : ''}
    </div>

    <div>
      <h2>Feed</h2>
      ${allItems.length === 0 ? '<div class="card text-muted">No activities yet.</div>' : ''}
      ${allItems.map(a => renderActivity(a)).join('')}
    </div>`;

  return htmlResponse(htmlPage('Activity', body, { user: username, nav: 'activity' }));
}

function renderActivity(activity) {
  const source = activity._source === 'inbox' ? 'Received' : 'Sent';
  const type = activity.type || 'Unknown';
  const actor = typeof activity.actor === 'string' ? activity.actor : activity.actor?.id || '';
  const published = activity.published ? new Date(activity.published).toLocaleString() : '';

  let content = '';
  if (type === 'Create' && activity.object) {
    const obj = typeof activity.object === 'string' ? {} : activity.object;
    if (obj.summary) content += `<div class="text-muted"><em>CW: ${escapeHtml(obj.summary)}</em></div>`;
    content += `<div>${obj.content || ''}</div>`;
  } else if (type === 'Follow') {
    const target = typeof activity.object === 'string' ? activity.object : activity.object?.id || '';
    content = `<div class="text-muted">Follow → ${escapeHtml(target)}</div>`;
  } else if (type === 'Accept') {
    content = `<div class="text-muted">Accepted activity</div>`;
  } else if (type === 'Undo') {
    content = `<div class="text-muted">Undid activity</div>`;
  } else {
    content = `<div class="text-muted">${escapeHtml(type)} activity</div>`;
  }

  return `
    <div class="card">
      <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
        <span class="mono" style="font-size: 0.8rem;">${escapeHtml(actor)}</span>
        <span class="text-muted">${escapeHtml(published)}</span>
      </div>
      <div style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem;">
        <span style="background: #e8e8e8; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.75rem;">${escapeHtml(type)}</span>
        <span style="background: ${source === 'Received' ? '#d4edda' : '#cce5ff'}; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.75rem;">${source}</span>
      </div>
      ${content}
    </div>`;
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
