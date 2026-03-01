/**
 * Dashboard page.
 */
import { renderPage } from '../shell.js';
import template from '../templates/dashboard.html';
import { requireAuth } from '../../auth/middleware.js';
import { parseNTriples, unwrapIri, unwrapLiteral } from '../../rdf/ntriples.js';
import { PREFIXES } from '../../rdf/prefixes.js';

export async function renderDashboard(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env } = reqCtx;
  const username = config.username;

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
  const breakdown = await computeStorageBreakdown(reqCtx.storage, config);

  return renderPage('Dashboard', template, {
    username,
    webId: config.webId,
    actorId: config.actorId,
    domain: config.domain,
    baseUrl: config.baseUrl,
    followerCount: followers.length,
    followingCount: following.length,
    postCount: outbox.length,
    pendingFollowCount: pendingFollows.length,
    hasPendingFollows: pendingFollows.length > 0,
    storageUsed: formatBytes(quota.usedBytes),
    webfingerParam: encodeURIComponent(username) + '@' + encodeURIComponent(config.domain),
    passkeys,
    hasPasskeys: passkeys.length > 0,
    storageBreakdown: breakdown.categories,
    hasBreakdown: breakdown.categories.length > 0,
    totalResources: breakdown.totalCount,
    totalResourcesPlural: breakdown.totalCount !== 1,
  }, { user: username, nav: 'dashboard', storage: reqCtx.storage, baseUrl: config.baseUrl });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
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
async function computeStorageBreakdown(storage, config) {
  const rootIri = `${config.baseUrl}/${config.username}/`;
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
      label: `${c.count} file${c.count !== 1 ? 's' : ''}`,
    }));

  return { categories, totalCount: resources.length };
}
