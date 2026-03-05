/**
 * Dashboard page.
 */
import { renderPage } from '../shell.js';
import template from '../templates/dashboard.html';
import { requireAuth } from '../../auth/middleware.js';
import { parseNTriples, unwrapIri, unwrapLiteral } from '../../rdf/ntriples.js';
import { PREFIXES } from '../../rdf/prefixes.js';
import { getUserConfig } from '../../config.js';
import { formatBytes } from '../../i18n/format.js';
import { getTranslations } from '../../i18n/index.js';

export async function renderDashboard(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env, lang } = reqCtx;
  const username = reqCtx.user;
  const uc = getUserConfig(config, username);
  const t = getTranslations(lang);

  // Load stats
  const [followersData, followingData, outboxData, quotaData, pendingData] = await Promise.all([
    env.APPDATA.get(`ap_followers:${username}`),
    env.APPDATA.get(`ap_following:${username}`),
    env.APPDATA.get(`ap_outbox_index:${username}`),
    env.APPDATA.get(`quota:${username}`),
    env.APPDATA.get(`ap_pending_follows:${username}`),
  ]);

  const followers = JSON.parse(followersData || '[]');
  const following = JSON.parse(followingData || '[]');
  const outbox = JSON.parse(outboxData || '[]');
  const quota = JSON.parse(quotaData || '{"usedBytes":0}');
  const pendingFollows = JSON.parse(pendingData || '[]');

  // Load passkey list
  const credIds = JSON.parse(await env.APPDATA.get(`webauthn_creds:${username}`) || '[]');
  const credResults = await Promise.all(
    credIds.map(id => env.APPDATA.get(`webauthn_cred:${username}:${id}`).then(d => d ? { id, ...JSON.parse(d) } : null))
  );
  const passkeys = credResults.filter(Boolean).map(c => ({ id: c.id, name: c.name, createdAt: c.createdAt }));

  // Compute storage breakdown by resource type
  const breakdown = await computeStorageBreakdown(reqCtx.storage, config, username, quota.usedBytes, t);

  // Plural labels
  const pendingFollowLabel = (pendingFollows.length === 1 ? t.dash_pending_follow_one : t.dash_pending_follow_other).replace('{{count}}', pendingFollows.length);
  const totalResourcesLabel = (breakdown.totalCount === 1 ? t.dash_resources_one : t.dash_resources_other).replace('{{count}}', breakdown.totalCount);

  return renderPage('Dashboard', template, {
    username,
    webId: uc.webId,
    actorId: uc.actorId,
    domain: config.domain,
    baseUrl: config.baseUrl,
    followerCount: followers.length,
    followingCount: following.length,
    postCount: outbox.length,
    pendingFollowCount: pendingFollows.length,
    pendingFollowLabel,
    hasPendingFollows: pendingFollows.length > 0,
    storageUsed: formatBytes(quota.usedBytes, lang),
    totalResourcesLabel,
    webfingerParam: encodeURIComponent(username) + '@' + encodeURIComponent(config.domain),
    passkeys,
    hasPasskeys: passkeys.length > 0,
    storageBreakdown: breakdown.categories,
    hasBreakdown: breakdown.categories.length > 0,
    totalResources: breakdown.totalCount,
    fedcmConfigURL: config.baseUrl + '/fedcm/config.json',
  }, { user: username, config, nav: 'dashboard', storage: reqCtx.storage, baseUrl: config.baseUrl, lang });
}

/**
 * Map a MIME type to a broad category.
 */
function categorize(contentType) {
  if (!contentType) return 'Other';
  const ct = contentType.toLowerCase();
  if (ct.startsWith('image/')) return 'Images';
  if (ct.startsWith('video/')) return 'Video';
  if (ct.startsWith('audio/')) return 'Audio';
  if (ct === 'text/turtle' || ct === 'application/ld+json' || ct === 'application/n-triples' || ct === 'application/n-quads' || ct === 'application/rdf+xml') return 'RDF / Linked Data';
  if (ct === 'text/html' || ct === 'text/css' || ct === 'application/javascript' || ct === 'text/javascript') return 'Web (HTML/CSS/JS)';
  if (ct.startsWith('text/')) return 'Text';
  if (ct === 'application/pdf') return 'Documents';
  if (ct === 'application/zip' || ct === 'application/gzip' || ct === 'application/x-tar') return 'Archives';
  if (ct === 'application/json') return 'Text';
  return 'Other';
}

/**
 * Recursively walk containers and gather resource size + type info.
 */
async function collectResources(storage, containerIri, results) {
  const docKey = `doc:${containerIri}:${containerIri}`;
  const ntData = await storage.get(docKey);
  if (!ntData) return;

  const triples = parseNTriples(ntData);
  const ldpContains = PREFIXES.ldp + 'contains';
  const contained = [];
  for (const t of triples) {
    if (unwrapIri(t.predicate) === ldpContains) {
      contained.push(unwrapIri(t.object));
    }
  }

  // Separate containers (recurse) from resources (process in parallel)
  const subContainers = contained.filter(uri => uri.endsWith('/'));
  const resources = contained.filter(uri => !uri.endsWith('/'));

  await Promise.all(subContainers.map(uri => collectResources(storage, uri, results)));

  // Fetch idx entries for all resources in parallel
  const idxEntries = await Promise.all(resources.map(uri => storage.get(`idx:${uri}`).then(d => d ? { uri, ...JSON.parse(d) } : null)));

  // Process each resource's metadata in parallel
  await Promise.all(idxEntries.filter(Boolean).map(async (entry) => {
    if (entry.binary) {
      const metaDoc = await storage.get(`doc:${entry.uri}.meta:${entry.uri}`);
      let contentType = 'application/octet-stream';
      let size = 0;
      if (metaDoc) {
        for (const mt of parseNTriples(metaDoc)) {
          const pred = unwrapIri(mt.predicate);
          if (pred === PREFIXES.dcterms + 'format') contentType = unwrapLiteral(mt.object);
          else if (pred === PREFIXES.dcterms + 'extent') size = parseInt(unwrapLiteral(mt.object), 10) || 0;
        }
      }
      results.push({ contentType, size });
    } else {
      const docs = await Promise.all((entry.subjects || []).map(subj => storage.get(`doc:${entry.uri}:${subj}`)));
      const totalLen = docs.reduce((sum, nt) => sum + (nt ? nt.length : 0), 0);
      results.push({ contentType: 'text/turtle', size: totalLen });
    }
  }));
}

/**
 * Compute storage breakdown grouped by resource category.
 */
async function computeStorageBreakdown(storage, config, username, totalUsedBytes, t) {
  const rootIri = `${config.baseUrl}/${username}/`;
  const resources = [];

  try {
    await collectResources(storage, rootIri, resources);
  } catch (e) {
    console.error('Error computing storage breakdown:', e);
    return { categories: [], totalCount: 0 };
  }

  // Aggregate by category
  const buckets = new Map();
  for (const r of resources) {
    const cat = categorize(r.contentType);
    const entry = buckets.get(cat) || { name: cat, bytes: 0, count: 0 };
    entry.bytes += r.size;
    entry.count += 1;
    buckets.set(cat, entry);
  }

  // Sort by bytes descending
  const categories = [...buckets.values()]
    .sort((a, b) => b.bytes - a.bytes)
    .map(c => ({
      name: c.name,
      size: formatBytes(c.bytes),
      count: c.count,
      label: (c.count === 1 ? t.dash_n_files_one : t.dash_n_files_other).replace('{{count}}', c.count),
    }));

  // Add "Everything Else" for unaccounted bytes (metadata, indexes, etc.)
  const categorizedBytes = [...buckets.values()].reduce((sum, c) => sum + c.bytes, 0);
  const remainder = (totalUsedBytes || 0) - categorizedBytes;
  if (remainder > 0) {
    categories.push({
      name: t.dash_everything_else || 'Everything Else',
      size: formatBytes(remainder),
      count: 0,
      label: t.dash_system_data || 'system data',
    });
  }

  return { categories, totalCount: resources.length };
}
