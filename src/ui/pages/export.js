/**
 * Data export and storage cleanup.
 *
 * Routes:
 *   GET  /settings/export  — stream a .tar.gz archive of selected data
 *   POST /settings/cleanup — remove orphaned KV/R2 keys not in the container tree
 */
import { requireAuth } from '../../auth/middleware.js';
import { simpleHash } from '../../utils.js';
import { parseNTriples, unwrapIri } from '../../rdf/ntriples.js';
import { PREFIXES } from '../../rdf/prefixes.js';
import { TarWriter } from '../tar-stream.js';

/**
 * Handle GET /settings/export — stream a .tar.gz of selected data categories.
 */
export async function handleExport(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env, url, ctx } = reqCtx;
  const username = reqCtx.user;
  const storage = reqCtx.storage;

  // Parse selected categories
  const categories = new Set(url.searchParams.getAll('cat'));
  if (categories.size === 0) {
    return new Response(null, { status: 302, headers: { 'Location': '/settings' } });
  }

  // Parse max individual file size (MB, 0 = no limit)
  const maxMB = parseInt(url.searchParams.get('maxFileSize') || '10', 10);
  const maxFileSize = maxMB > 0 ? maxMB * 1024 * 1024 : Infinity;

  // Set up streaming pipeline: tar → gzip → response
  const { readable, writable } = new TransformStream();
  const gzip = new CompressionStream('gzip');

  // Start archive generation in the background
  const gzipWriter = gzip.writable.getWriter();
  const tar = new TarWriter(gzipWriter);

  ctx.waitUntil(
    generateArchive(tar, gzipWriter, { categories, maxFileSize, username, config, env, storage })
  );

  // Pipe gzip output to the response stream
  gzip.readable.pipeTo(writable);

  const date = new Date().toISOString().slice(0, 10);
  const filename = `${username}-export-${date}.tar.gz`;

  return new Response(readable, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Generate the archive contents across all selected categories.
 */
async function generateArchive(tar, gzipWriter, opts) {
  try {
    const { categories, maxFileSize, username, config, env, storage } = opts;
    const basePrefix = `${config.baseUrl}/${username}/`;

    if (categories.has('pod'))         await exportPod(tar, env, basePrefix, maxFileSize);
    if (categories.has('activitypub')) await exportActivityPub(tar, env, username);
    if (categories.has('profile'))     await exportProfile(tar, env, username);
    if (categories.has('keys'))        await exportKeys(tar, env, username);

    await tar.finalize();
    await gzipWriter.close();
  } catch (err) {
    console.error('Export error:', err);
    try { await gzipWriter.abort(err); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Category: Pod resources (TRIPLESTORE KV)
// ---------------------------------------------------------------------------

async function exportPod(tar, env, basePrefix, maxFileSize) {
  const ldpContains = PREFIXES.ldp + 'contains';

  // Traverse the container tree starting from the user's root container,
  // following ldp:contains triples. This ensures only live resources are
  // exported — deleted resources whose KV keys may linger are skipped.
  async function exportContainer(containerIri) {
    const rel = containerIri.slice(basePrefix.length);
    await exportResource(containerIri, `pod/${rel}_container.nt`);
    await exportAcp(containerIri, `pod/${rel}.acp.json`);

    // Read container doc to find children
    const ntData = await env.TRIPLESTORE.get(`doc:${containerIri}:${containerIri}`, 'text');
    if (!ntData) return;

    const triples = parseNTriples(ntData);
    for (const t of triples) {
      if (unwrapIri(t.predicate) === ldpContains) {
        const childIri = unwrapIri(t.object);
        if (childIri.endsWith('/')) {
          await exportContainer(childIri);
        } else {
          await exportChild(childIri);
        }
      }
    }
  }

  async function exportChild(iri) {
    const rel = iri.slice(basePrefix.length);
    const indexJson = await env.TRIPLESTORE.get(`idx:${iri}`, 'text');
    if (!indexJson) return;
    const index = JSON.parse(indexJson);

    if (index.binary) {
      // Binary resource: export metadata + actual file from R2
      const meta = await env.TRIPLESTORE.get(`doc:${iri}.meta:${iri}`, 'text');
      if (meta) await tar.addFile(`pod/${rel}.meta.nt`, meta);

      if (env.BLOBS) {
        const r2Obj = await env.BLOBS.get(`blob:${iri}`);
        if (r2Obj && r2Obj.size <= maxFileSize) {
          await tar.addFileFromStream(`pod/${rel}`, r2Obj.size, r2Obj.body);
        }
      }
    } else {
      await exportResource(iri, `pod/${rel}.nt`);
    }

    await exportAcp(iri, `pod/${rel}.acp.json`);
  }

  async function exportResource(iri, archivePath) {
    const indexJson = await env.TRIPLESTORE.get(`idx:${iri}`, 'text');
    if (!indexJson) return;
    const index = JSON.parse(indexJson);
    const subjects = index.subjects || [iri];
    const parts = [];
    for (const subj of subjects) {
      const nt = await env.TRIPLESTORE.get(`doc:${iri}:${subj}`, 'text');
      if (nt) parts.push(nt);
    }
    if (parts.length > 0) await tar.addFile(archivePath, parts.join('\n'));
  }

  async function exportAcp(iri, archivePath) {
    const data = await env.APPDATA.get(`acp:${iri}`, 'text');
    if (data) await tar.addFile(archivePath, data);
  }

  await exportContainer(basePrefix);
}

// ---------------------------------------------------------------------------
// Category: ActivityPub data (APPDATA KV)
// ---------------------------------------------------------------------------

async function exportActivityPub(tar, env, username) {
  // Fixed keys
  const fixed = [
    [`ap_followers:${username}`, 'activitypub/followers.json'],
    [`ap_following:${username}`, 'activitypub/following.json'],
    [`ap_pending_follows:${username}`, 'activitypub/pending_follows.json'],
    [`ap_read_watermark:${username}`, 'activitypub/read_watermark.txt'],
    [`ap_read_items:${username}`, 'activitypub/read_items.json'],
  ];
  for (const [key, file] of fixed) {
    const data = await env.APPDATA.get(key);
    if (data) await tar.addFile(file, data);
  }

  // Outbox index + items
  const outboxRaw = await env.APPDATA.get(`ap_outbox_index:${username}`);
  const outboxIndex = JSON.parse(outboxRaw || '[]');
  if (outboxIndex.length > 0) {
    await tar.addFile('activitypub/outbox_index.json', JSON.stringify(outboxIndex, null, 2));
    for (const entry of outboxIndex) {
      const hash = simpleHash(entry.id);
      const data = await env.APPDATA.get(`ap_outbox_item:${hash}`);
      if (data) await tar.addFile(`activitypub/outbox/${hash}.json`, data);
    }
  }

  // Inbox index + items
  const inboxRaw = await env.APPDATA.get(`ap_inbox_index:${username}`);
  const inboxIndex = JSON.parse(inboxRaw || '[]');
  if (inboxIndex.length > 0) {
    await tar.addFile('activitypub/inbox_index.json', JSON.stringify(inboxIndex, null, 2));
    for (const entry of inboxIndex) {
      const hash = simpleHash(entry.id);
      const data = await env.APPDATA.get(`ap_inbox_item:${hash}`);
      if (data) await tar.addFile(`activitypub/inbox/${hash}.json`, data);
    }
  }
}

// ---------------------------------------------------------------------------
// Category: Profile & settings (APPDATA KV)
// ---------------------------------------------------------------------------

async function exportProfile(tar, env, username) {
  const keys = [
    [`user_prefs:${username}`, 'profile/user_prefs.json'],
    [`profile_layout:${username}`, 'profile/profile_layout.json'],
    [`custom_prefixes:${username}`, 'profile/custom_prefixes.json'],
    [`friends:${username}`, 'profile/friends.json'],
    [`component_registry:${username}`, 'profile/component_registry.json'],
    [`quota:${username}`, 'profile/quota.json'],
  ];
  for (const [key, file] of keys) {
    const data = await env.APPDATA.get(key);
    if (data) await tar.addFile(file, data);
  }

  // App permissions
  const appIndex = await env.APPDATA.get(`app_perms_index:${username}`);
  if (appIndex) {
    await tar.addFile('profile/app_perms_index.json', appIndex);
    const entries = JSON.parse(appIndex);
    for (const entry of entries) {
      const data = await env.APPDATA.get(`app_perm:${username}:${entry.hash}`);
      if (data) await tar.addFile(`profile/app_perms/${entry.hash}.json`, data);
    }
  }
}

// ---------------------------------------------------------------------------
// Category: Cryptographic keys (APPDATA KV)
// ---------------------------------------------------------------------------

async function exportKeys(tar, env, username) {
  const priv = await env.APPDATA.get(`ap_private_key:${username}`);
  const pub = await env.APPDATA.get(`ap_public_key:${username}`);
  if (priv) await tar.addFile('keys/ap_private_key.pem', priv);
  if (pub)  await tar.addFile('keys/ap_public_key.pem', pub);
}

// ---------------------------------------------------------------------------
// Storage cleanup: remove orphaned KV/R2 keys
// ---------------------------------------------------------------------------

/**
 * Handle POST /settings/cleanup — delete orphaned storage keys.
 *
 * Walks the container tree to build the set of live resource IRIs, then
 * lists all TRIPLESTORE/APPDATA/R2 keys for the user and deletes any
 * that don't belong to a live resource.
 */
export async function handleCleanup(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env, lang } = reqCtx;
  const { getTranslations } = await import('../../i18n/index.js');
  const t = getTranslations(lang);
  const username = reqCtx.user;
  const basePrefix = `${config.baseUrl}/${username}/`;
  const ldpContains = PREFIXES.ldp + 'contains';

  // 1. Walk the container tree to collect all live resource IRIs
  const liveIris = new Set();

  async function walkContainer(containerIri) {
    liveIris.add(containerIri);
    const ntData = await env.TRIPLESTORE.get(`doc:${containerIri}:${containerIri}`, 'text');
    if (!ntData) return;
    const triples = parseNTriples(ntData);
    for (const triple of triples) {
      if (unwrapIri(triple.predicate) === ldpContains) {
        const childIri = unwrapIri(triple.object);
        liveIris.add(childIri);
        if (childIri.endsWith('/')) {
          await walkContainer(childIri);
        }
      }
    }
  }

  await walkContainer(basePrefix);

  // 2. List all idx: keys and delete orphans from TRIPLESTORE + R2
  let removed = 0;
  let cursor;
  const idxPrefix = `idx:${basePrefix}`;
  do {
    const result = await env.TRIPLESTORE.list({ prefix: idxPrefix, cursor, limit: 500 });
    for (const key of result.keys) {
      const iri = key.name.slice(4); // strip "idx:"
      if (liveIris.has(iri)) continue;

      // Orphaned resource — delete all associated keys
      const indexJson = await env.TRIPLESTORE.get(key.name, 'text');
      if (indexJson) {
        const index = JSON.parse(indexJson);
        for (const subj of index.subjects || []) {
          await env.TRIPLESTORE.delete(`doc:${iri}:${subj}`);
        }
      }
      await env.TRIPLESTORE.delete(key.name);
      await env.TRIPLESTORE.delete(`doc:${iri}.meta:${iri}`);
      await env.TRIPLESTORE.delete(`acl:${iri}`);
      await env.APPDATA.delete(`acp:${iri}`);
      if (env.BLOBS) {
        try { await env.BLOBS.delete(`blob:${iri}`); } catch {}
      }
      removed++;
    }
    cursor = result.list_complete ? null : result.cursor;
  } while (cursor);

  // 3. Clean orphaned ACP policies (acp: keys with no live resource)
  const acpPrefix = `acp:${basePrefix}`;
  let acpCursor;
  do {
    const result = await env.APPDATA.list({ prefix: acpPrefix, cursor: acpCursor, limit: 500 });
    for (const key of result.keys) {
      const iri = key.name.slice(4); // strip "acp:"
      if (!liveIris.has(iri)) {
        await env.APPDATA.delete(key.name);
        removed++;
      }
    }
    acpCursor = result.list_complete ? null : result.cursor;
  } while (acpCursor);

  const msg = t.cleanup_done
    ? t.cleanup_done.replace('{count}', removed)
    : `Cleaned up ${removed} orphaned entries.`;
  return new Response(null, {
    status: 302,
    headers: { 'Location': `/settings?message=${encodeURIComponent(msg)}` },
  });
}
