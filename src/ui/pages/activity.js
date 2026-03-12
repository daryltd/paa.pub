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
import { userExists } from '../../users.js';
import { getTranslations } from '../../i18n/index.js';
import { formatDateTime } from '../../i18n/format.js';

export async function renderActivityPage(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env, url, lang } = reqCtx;
  const username = reqCtx.user;
  const error = url.searchParams.get('error');
  const feedLimit = config.feedLimit;
  const t = getTranslations(lang);

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

  // Feed filter: 'received' (default), 'sent', or 'all'
  const feed = url.searchParams.get('feed') || 'received';
  let allItems;
  if (feed === 'sent') {
    allItems = outboxItems.map(a => ({ ...a, _source: 'outbox' }));
  } else if (feed === 'all') {
    allItems = [
      ...inboxItems.map(a => ({ ...a, _source: 'inbox' })),
      ...outboxItems.map(a => ({ ...a, _source: 'outbox' })),
    ];
  } else {
    // Default: received only
    allItems = inboxItems.map(a => ({ ...a, _source: 'inbox' }));
  }
  allItems.sort((a, b) => (b.published || '').localeCompare(a.published || ''));
  allItems = allItems.slice(0, feedLimit);

  // Filter out read items unless ?show=all
  const showAll = url.searchParams.get('show') === 'all';
  if (!showAll) {
    allItems = allItems.filter(a => {
      if (watermark && a.published && a.published <= watermark) return false;
      if (readSet.has(a.id)) return false;
      return true;
    });
  }

  const feedReceived = feed === 'received' || !feed;
  const feedSent = feed === 'sent';
  const feedAll = feed === 'all';

  // Pre-process activities into display categories for Mustache.
  // Categories based on the full AS2 vocabulary (https://www.w3.org/TR/activitystreams-vocabulary):
  //
  //   isContent   — Create, Update: show embedded object content
  //   isQuestion  — Question: show question text and options
  //   isResponse  — Accept, Reject, TentativeAccept, TentativeReject: show what was responded to
  //   isUndo      — Undo: show inner activity info
  //   isDelete    — Delete: show deleted object reference
  //   isObject    — Like, Dislike, Read, View, Listen, Follow, Block, Ignore,
  //                 Announce, Flag, Add, Remove, Invite, Offer, Join, Leave,
  //                 Arrive, Move, Travel, and any other type: show object as link
  //
  const CONTENT_TYPES = new Set(['Create', 'Update']);
  const QUESTION_TYPES = new Set(['Question']);
  const RESPONSE_TYPES = new Set(['Accept', 'Reject', 'TentativeAccept', 'TentativeReject']);
  const UNDO_TYPES = new Set(['Undo']);
  const DELETE_TYPES = new Set(['Delete']);

  const activities = allItems.map(a => {
    const source = a._source === 'inbox' ? t.act_source_received : t.act_source_sent;
    const type = a.type || t.act_type_unknown;
    const actor = typeof a.actor === 'string' ? a.actor : a.actor?.id || '';
    const published = a.published ? formatDateTime(a.published, lang) : '';
    const isReceived = a._source === 'inbox';
    const actSummary = a.summary || '';
    const hasActivitySummary = !!actSummary;

    const obj = a.object;
    const objectInfo = extractObjectInfo(obj);
    const targetInfo = extractObjectInfo(a.target, 'target');
    const originInfo = extractObjectInfo(a.origin, 'origin');

    let isContent = false, isQuestion = false, isResponse = false, isUndo = false, isDelete = false, isObject = false;
    let content = '', summary = '', hasSummary = false;
    let innerType = '', innerActor = '';

    // Question-type activities (Question is both an activity type and object type)
    let questionName = '', hasQuestionName = false;
    let questionOptions = [], hasQuestionOptions = false;

    if (CONTENT_TYPES.has(a.type)) {
      isContent = true;
      if (obj && typeof obj !== 'string') {
        content = obj.content || '';
        summary = obj.summary || '';
        hasSummary = !!summary;
      }
    } else if (QUESTION_TYPES.has(a.type)) {
      isQuestion = true;
      questionName = a.name || a.content || '';
      hasQuestionName = !!questionName;
      // AS2 Question can have oneOf/anyOf options
      const opts = a.oneOf || a.anyOf || [];
      questionOptions = (Array.isArray(opts) ? opts : []).map(o => ({
        optName: typeof o === 'string' ? o : (o.name || o.content || o.id || ''),
        optUrl: typeof o === 'string' ? '' : (o.id || o.url || o.href || ''),
        hasOptUrl: !!(typeof o !== 'string' && (o.id || o.url || o.href)),
      }));
      hasQuestionOptions = questionOptions.length > 0;
    } else if (RESPONSE_TYPES.has(a.type)) {
      isResponse = true;
      // The object of Accept/Reject is the activity being responded to
      if (obj && typeof obj !== 'string') {
        innerType = obj.type || '';
        innerActor = typeof obj.actor === 'string' ? obj.actor : obj.actor?.id || '';
      }
    } else if (UNDO_TYPES.has(a.type)) {
      isUndo = true;
      if (obj && typeof obj !== 'string') {
        innerType = obj.type || '';
        innerActor = typeof obj.actor === 'string' ? obj.actor : obj.actor?.id || '';
      }
    } else if (DELETE_TYPES.has(a.type)) {
      isDelete = true;
    } else {
      // All other activity types: show object as linked reference
      // This covers: Like, Dislike, Read, View, Listen, Follow, Block, Ignore,
      // Announce, Flag, Add, Remove, Invite, Offer, Join, Leave, Arrive,
      // Move, Travel, and any extension types.
      isObject = true;
    }

    // Location info (for Arrive, Travel, Move, or any activity with location)
    const loc = a.location;
    const locationName = loc ? (typeof loc === 'string' ? loc : loc.name || loc.id || '') : '';
    const locationUrl = loc && typeof loc !== 'string' ? (loc.id || loc.url || '') : '';
    const hasLocation = !!locationName;
    const hasLocationUrl = !!locationUrl;

    // Instrument (tool used to perform the activity)
    const inst = a.instrument;
    const instrumentName = inst ? (typeof inst === 'string' ? inst : inst.name || inst.id || '') : '';
    const hasInstrument = !!instrumentName;

    return {
      activityId: a.id, source, type, actor, published, isReceived,
      isContent, isQuestion, isResponse, isUndo, isDelete, isObject,
      content, summary, hasSummary,
      actSummary, hasActivitySummary,
      innerType, innerActor, hasInnerType: !!innerType, hasInnerActor: !!innerActor,
      questionName, hasQuestionName, questionOptions, hasQuestionOptions,
      locationName, locationUrl, hasLocation, hasLocationUrl,
      instrumentName, hasInstrument,
      ...objectInfo,
      ...targetInfo,
      ...originInfo,
    };
  });

  // Format pending follow requests for template
  const pendingRequests = pendingFollows.map(p => ({
    actor: p.actor,
    receivedAt: p.receivedAt ? formatDateTime(p.receivedAt, lang) : '',
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
    feedReceived,
    feedSent,
    feedAll,
  }, { user: username, config, nav: 'activity', storage: reqCtx.storage, baseUrl: config.baseUrl, lang });
}

/**
 * Render a remote actor's public feed.
 * GET /activity/remote?actor=<uri>
 */
export async function renderRemoteFeed(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env, url, lang } = reqCtx;
  const username = reqCtx.user;
  const actorUri = url.searchParams.get('actor');
  const t = getTranslations(lang);
  if (!actorUri) {
    return new Response(null, { status: 302, headers: { 'Location': '/activity' } });
  }

  const feedLimit = config.feedLimit;

  // Resolve actor and outbox — local actors are read from KV directly
  let actor, items = [];
  const localTarget = resolveLocalUsername(actorUri, config);

  if (localTarget && await userExists(env.APPDATA, localTarget)) {
    // Local actor: read outbox directly from KV storage
    actor = { preferredUsername: localTarget, name: localTarget, outbox: `${config.baseUrl}/${localTarget}/outbox` };
    const indexData = await env.APPDATA.get(`ap_outbox_index:${localTarget}`);
    const index = JSON.parse(indexData || '[]').slice(0, feedLimit);
    const results = await Promise.all(
      index.map(entry => env.APPDATA.get(`ap_outbox_item:${simpleHash(entry.id)}`))
    );
    items = results.filter(Boolean).map(d => JSON.parse(d));
  } else {
    // Remote actor: fetch via HTTP
    actor = await fetchRemoteActor(actorUri, env.APPDATA);
    if (!actor || !actor.outbox) {
      return renderPage(t.act_remote_feed, `<h1>${escapeHtml(t.act_remote_feed)}</h1><div class="card"><div class="text-muted">${escapeHtml(t.act_could_not_load)}</div><a href="/activity" class="btn mt-05">${escapeHtml(t.act_back)}</a></div>`, {}, { user: username, config, nav: 'activity', storage: reqCtx.storage, baseUrl: config.baseUrl, lang });
    }

    // Fetch the outbox collection
    try {
      const outboxRes = await fetch(actor.outbox, {
        headers: { 'Accept': 'application/activity+json, application/ld+json' },
        signal: AbortSignal.timeout(10000),
      });
      if (outboxRes.ok) {
        const outbox = await outboxRes.json();
        if (outbox.orderedItems) {
          items = outbox.orderedItems.slice(0, feedLimit);
        } else if (outbox.first) {
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
  }

  // Process items for display using the same category system
  const activities = items.map(a => {
    const type = a.type || t.act_type_unknown;
    const published = a.published ? formatDateTime(a.published, lang) : '';
    const objectInfo = extractObjectInfo(a.object);
    const isContent = a.type === 'Create' || a.type === 'Update';
    const isObject = !isContent;
    let content = '', summary = '', hasSummary = false;

    if (isContent && a.object && typeof a.object !== 'string') {
      content = a.object.content || '';
      summary = a.object.summary || '';
      hasSummary = !!summary;
    }

    return {
      type, published, isContent, isObject,
      content, summary, hasSummary,
      actSummary: a.summary || '', hasActivitySummary: !!a.summary,
      ...objectInfo,
    };
  });

  const actorName = actor.preferredUsername || actor.name || actorUri;

  const body = `<h1>${escapeHtml(t.act_feed_prefix)} ${escapeHtml(actorName)}</h1>
<div class="card">
  <div class="mono text-muted text-sm break-all mb-05">${escapeHtml(actorUri)}</div>
  <a href="/activity" class="btn btn-secondary">${escapeHtml(t.act_back_to_activity)}</a>
</div>
${activities.length === 0 ? `<div class="card text-muted">${escapeHtml(t.act_no_public)}</div>` : ''}
${activities.map(a => `<div class="card">
  <div class="flex justify-between mb-05">
    <span class="badge badge-type">${escapeHtml(a.type)}</span>
    <span class="text-muted">${escapeHtml(a.published)}</span>
  </div>
  ${a.hasActivitySummary ? `<div class="text-muted text-sm mb-05"><em>${escapeHtml(a.actSummary)}</em></div>` : ''}
  ${a.isContent ? `${a.hasSummary ? `<div class="text-muted"><em>${escapeHtml(t.act_cw_prefix)} ${escapeHtml(a.summary)}</em></div>` : ''}
  <div>${a.content}</div>` : `${a.hasObjectUrl ? `<div>${a.hasObjectType ? `<span class="badge badge-type">${escapeHtml(a.objectType)}</span> ` : ''}<a href="${escapeHtml(a.objectUrl)}" target="_blank" rel="noopener" class="mono break-all text-sm">${escapeHtml(a.objectName)}</a></div>` : `<div class="text-muted">${escapeHtml(a.type)} ${escapeHtml(t.act_type_activity)}</div>`}`}
</div>`).join('\n')}`;

  return renderPage(t.act_remote_feed, body, {}, { user: username, config, nav: 'activity', storage: reqCtx.storage, baseUrl: config.baseUrl, lang });
}

function resolveLocalUsername(actorUri, config) {
  if (!actorUri.startsWith(config.baseUrl + '/')) return null;
  const parts = actorUri.slice(config.baseUrl.length + 1).split('/');
  if (parts[1] === 'profile' && parts[2]?.startsWith('card')) return parts[0];
  return null;
}

/**
 * Extract displayable info from an activity's object/target/origin field.
 * @param {*} obj - the field value (string, object, or undefined)
 * @param {string} prefix - key prefix: '' for object, 'target' for target, 'origin' for origin
 * Returns Mustache-friendly flat fields with prefixed keys.
 */
function extractObjectInfo(obj, prefix) {
  const p = prefix || 'object';
  const empty = {
    [`has${cap(p)}`]: false,
  };
  if (!obj) return empty;

  // String = just a URI
  if (typeof obj === 'string') {
    return {
      [`has${cap(p)}`]: true,
      [`${p}Url`]: obj,
      [`${p}Name`]: obj,
      [`has${cap(p)}Url`]: true,
      [`${p}Type`]: '',
      [`has${cap(p)}Type`]: false,
      [`has${cap(p)}Image`]: false,
      [`has${cap(p)}Attachments`]: false,
    };
  }

  const url = obj.id || obj.url || obj.href || '';
  const name = obj.name || obj.title || obj.preferredUsername || '';
  const objectType = obj.type || '';
  const hasUrl = !!url;
  const content = obj.content || '';

  // Media URL for Image, Audio, Video
  const mediaTypes = new Set(['Image', 'Audio', 'Video']);
  const isMedia = mediaTypes.has(obj.type);
  const imageUrl = obj.type === 'Image' ? (obj.url || obj.id || '') : '';
  const mediaUrl = isMedia ? (obj.url || obj.id || '') : '';

  // Attachments
  const attachments = Array.isArray(obj.attachment) ? obj.attachment.map(att => {
    const attUrl = att.id || att.url || att.href || '';
    const attName = att.name || att.title || attUrl;
    const attType = att.type || '';
    const isImage = attType === 'Image';
    return { attUrl, attName, attType, isImage, hasAttUrl: !!attUrl };
  }) : [];

  // Tags / mentions
  const tags = Array.isArray(obj.tag) ? obj.tag.map(tag => {
    const tagUrl = tag.href || tag.id || tag.url || '';
    const tagName = tag.name || tagUrl;
    return { tagUrl, tagName, hasTagUrl: !!tagUrl };
  }) : [];

  return {
    [`has${cap(p)}`]: true,
    [`${p}Url`]: url,
    [`${p}Name`]: name || url,
    [`has${cap(p)}Url`]: hasUrl,
    [`${p}Type`]: objectType,
    [`has${cap(p)}Type`]: !!objectType,
    [`has${cap(p)}Image`]: !!imageUrl,
    [`${p}ImageUrl`]: imageUrl,
    [`${p}Content`]: content,
    [`has${cap(p)}Content`]: !!content,
    [`${p}MediaUrl`]: mediaUrl,
    [`has${cap(p)}Media`]: !!mediaUrl && isMedia,
    [`${p}IsAudio`]: obj.type === 'Audio',
    [`${p}IsVideo`]: obj.type === 'Video',
    [`has${cap(p)}Attachments`]: attachments.length > 0,
    [`${p}Attachments`]: attachments,
    [`has${cap(p)}Tags`]: tags.length > 0,
    [`${p}Tags`]: tags,
  };
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

  const { env, request } = reqCtx;
  const username = reqCtx.user;
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

  const { env } = reqCtx;
  const username = reqCtx.user;

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
