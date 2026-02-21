/**
 * Storage browser page: file listing, upload, container creation,
 * resource editing, metadata management, and deletion.
 */
import { htmlPage, htmlResponse, escapeHtml } from '../shell.js';
import { requireAuth } from '../../auth/middleware.js';
import { parseNTriples, unwrapIri, serializeNTriples, iri, literal, typedLiteral } from '../../rdf/ntriples.js';
import { PREFIXES } from '../../rdf/prefixes.js';

const TEXT_EXTS = new Set([
  'ttl', 'txt', 'html', 'css', 'csv', 'xml', 'md', 'n3',
  'json', 'jsonld', 'nt', 'nq', 'js', 'ts', 'svg', 'rdf',
]);

const EXT_TO_CT = {
  ttl: 'text/turtle', txt: 'text/plain', html: 'text/html',
  css: 'text/css', csv: 'text/csv', xml: 'application/xml',
  md: 'text/markdown', n3: 'text/n3', json: 'application/json',
  jsonld: 'application/ld+json', nt: 'application/n-triples',
  nq: 'application/n-quads', js: 'application/javascript',
  svg: 'image/svg+xml', rdf: 'application/rdf+xml',
};

function isTextResource(name) {
  return TEXT_EXTS.has((name.split('.').pop() || '').toLowerCase());
}
function contentTypeForExt(name) {
  return EXT_TO_CT[(name.split('.').pop() || '').toLowerCase()] || 'text/plain';
}
function isImageType(ct) {
  return ct && ct.startsWith('image/');
}

// ── GET /storage/** ──────────────────────────────────

export async function renderStoragePage(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, storage, env, url } = reqCtx;
  const username = config.username;
  const path = url.pathname.replace(/^\/storage\/?/, '') || `${username}/`;
  const resourceIri = `${config.baseUrl}/${path}`;
  const isDir = path.endsWith('/');
  const editMode = url.searchParams.get('edit') === '1';
  const editMeta = url.searchParams.get('meta') === '1';

  if (isDir) return renderContainerPage(reqCtx, path, resourceIri, username);
  return renderResourcePage(reqCtx, path, resourceIri, username, editMode, editMeta);
}

// ── Container page ───────────────────────────────────

async function renderContainerPage(reqCtx, path, resourceIri, username) {
  const { config, storage } = reqCtx;
  const listing = await renderContainerListing(resourceIri, config, storage);
  const isRoot = path === `${username}/`;

  const body = `
    <h1>Storage</h1>
    <div class="card">
      <div class="text-muted" style="margin-bottom: 0.5rem;">Path: <span class="mono">${escapeHtml('/' + path)}</span></div>
      ${renderBreadcrumbs(path)}
    </div>
    <div class="card">
      <h2>Upload File</h2>
      <form method="POST" action="/storage/${escapeHtml(path)}" enctype="multipart/form-data">
        <input type="hidden" name="action" value="upload">
        <div class="form-group"><input type="file" name="file" required></div>
        <div class="form-group"><input type="text" name="slug" placeholder="Filename (optional, uses original name if empty)"></div>
        <button type="submit" class="btn">Upload</button>
      </form>
    </div>
    <div class="card">
      <h2>Create Container</h2>
      <form method="POST" action="/storage/${escapeHtml(path)}">
        <input type="hidden" name="action" value="mkdir">
        <div style="display:flex;gap:0.5rem;">
          <input type="text" name="name" placeholder="Container name" required style="flex:1;">
          <button type="submit" class="btn">Create</button>
        </div>
      </form>
    </div>
    <div class="card">
      <h2>Contents</h2>
      ${listing}
      <div style="margin-top:0.75rem;display:flex;gap:0.5rem;">
        <a href="/acp/${escapeHtml(path)}" class="btn btn-secondary" style="font-size:0.8rem;">Access Policy</a>
        ${!isRoot ? `
          <form method="POST" action="/storage/${escapeHtml(path)}" class="inline">
            <input type="hidden" name="action" value="delete">
            <button type="submit" class="btn btn-danger" style="font-size:0.8rem;"
              onclick="return confirm('Delete this container and all its contents?')">Delete Container</button>
          </form>
        ` : ''}
      </div>
    </div>`;
  return htmlResponse(htmlPage('Storage', body, { user: username, nav: 'storage' }));
}

// ── Resource page ────────────────────────────────────

async function renderResourcePage(reqCtx, path, resourceIri, username, editMode, editMeta) {
  const { config, storage } = reqCtx;
  const { content, contentType, isBinary, size } = await loadResource(resourceIri, storage);
  const canEdit = isTextResource(path);
  const resourceUrl = `/${path}`;

  // Metadata
  const metaTriples = await loadMetadata(resourceIri, storage);
  const metaTurtle = metaTriples.length > 0
    ? metaTriples.map(t => `${t.subject} ${t.predicate} ${t.object} .`).join('\n')
    : '';

  // Content section
  let contentSection;
  if (editMode && canEdit) {
    contentSection = `
      <form method="POST" action="/storage/${escapeHtml(path)}">
        <input type="hidden" name="action" value="save">
        <div class="form-group"><label for="content">Content</label>
          <textarea id="content" name="content" rows="20" class="mono" style="font-size:0.85rem;tab-size:2;">${escapeHtml(content || '')}</textarea>
        </div>
        <div style="display:flex;gap:0.5rem;">
          <button type="submit" class="btn">Save</button>
          <a href="/storage/${escapeHtml(path)}" class="btn btn-secondary">Cancel</a>
        </div>
      </form>`;
  } else if (isBinary && isImageType(contentType)) {
    contentSection = `
      <div style="margin-bottom:0.75rem;">
        <img src="${escapeHtml(resourceUrl)}" alt="${escapeHtml(path.split('/').pop())}" style="max-width:100%;border-radius:4px;">
      </div>
      <div class="text-muted">${escapeHtml(contentType)} &middot; ${formatBytes(size)}</div>
      <div style="margin-top:0.5rem;"><a href="${escapeHtml(resourceUrl)}" class="mono text-muted" target="_blank">${escapeHtml(config.baseUrl + resourceUrl)}</a></div>`;
  } else if (isBinary) {
    contentSection = `
      <div class="text-muted">${escapeHtml(contentType)} &middot; ${formatBytes(size)}</div>
      <div style="margin-top:0.5rem;"><a href="${escapeHtml(resourceUrl)}" class="btn btn-secondary" target="_blank">Download File</a></div>
      <div style="margin-top:0.5rem;"><a href="${escapeHtml(resourceUrl)}" class="mono text-muted" target="_blank">${escapeHtml(config.baseUrl + resourceUrl)}</a></div>`;
  } else if (content !== null) {
    contentSection = `
      <pre class="mono" style="font-size:0.85rem;background:#f8f8f8;padding:1rem;border-radius:4px;overflow-x:auto;white-space:pre-wrap;">${escapeHtml(content)}</pre>`;
  } else {
    contentSection = `<div class="text-muted">Resource exists but has no content.</div>`;
  }

  // Metadata section
  let metaSection;
  if (editMeta) {
    metaSection = `
      <form method="POST" action="/storage/${escapeHtml(path)}">
        <input type="hidden" name="action" value="save_meta">
        <div class="form-group"><label for="metadata">Linked Metadata (N-Triples)</label>
          <textarea id="metadata" name="metadata" rows="8" class="mono" style="font-size:0.85rem;">${escapeHtml(metaTurtle)}</textarea>
        </div>
        <div class="text-muted" style="font-size:0.8rem;margin-bottom:0.75rem;">
          Subject should be <code class="mono">&lt;${escapeHtml(resourceIri)}&gt;</code>.
          Common predicates: <code class="mono">dcterms:title</code>, <code class="mono">dcterms:description</code>, <code class="mono">dcterms:creator</code>, <code class="mono">schema:keywords</code>.
        </div>
        <div style="display:flex;gap:0.5rem;">
          <button type="submit" class="btn">Save Metadata</button>
          <a href="/storage/${escapeHtml(path)}" class="btn btn-secondary">Cancel</a>
        </div>
      </form>`;
  } else {
    const metaDisplay = metaTriples.length > 0
      ? `<table style="font-size:0.85rem;">${metaTriples.map(t => {
          const pred = unwrapIri(t.predicate).split(/[#/]/).pop();
          let val = t.object;
          if (val.startsWith('"')) val = val.match(/^"([^"]*)"/)?.[1] || val;
          else if (val.startsWith('<')) val = unwrapIri(val);
          return `<tr><td class="text-muted">${escapeHtml(pred)}</td><td class="mono">${escapeHtml(val)}</td></tr>`;
        }).join('')}</table>`
      : '<div class="text-muted">No metadata.</div>';
    metaSection = `
      ${metaDisplay}
      <div style="margin-top:0.5rem;">
        <a href="/storage/${escapeHtml(path)}?meta=1" class="btn btn-secondary" style="font-size:0.8rem;">Edit Metadata</a>
      </div>`;
  }

  const body = `
    <h1>Storage</h1>
    <div class="card">
      <div class="text-muted" style="margin-bottom:0.5rem;">Path: <span class="mono">${escapeHtml('/' + path)}</span></div>
      ${renderBreadcrumbs(path)}
    </div>
    <div class="card">
      <h2>Resource</h2>
      ${contentSection}
      <div style="margin-top:0.75rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
        <a href="${escapeHtml(resourceUrl)}" class="btn btn-secondary" style="font-size:0.8rem;" target="_blank">View Raw</a>
        ${canEdit && !editMode ? `<a href="/storage/${escapeHtml(path)}?edit=1" class="btn" style="font-size:0.8rem;">Edit</a>` : ''}
        <a href="/acp/${escapeHtml(path)}" class="btn btn-secondary" style="font-size:0.8rem;">Access Policy</a>
        <form method="POST" action="/storage/${escapeHtml(path)}" class="inline">
          <input type="hidden" name="action" value="delete">
          <button type="submit" class="btn btn-danger" style="font-size:0.8rem;"
            onclick="return confirm('Delete this resource?')">Delete</button>
        </form>
      </div>
    </div>
    <div class="card">
      <h2>Metadata</h2>
      ${metaSection}
    </div>`;

  return htmlResponse(htmlPage('Storage', body, { user: username, nav: 'storage' }));
}

// ── POST /storage/** ─────────────────────────────────

export async function handleStorageAction(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { request, config, storage, env, url } = reqCtx;
  const path = url.pathname.replace(/^\/storage\/?/, '') || `${config.username}/`;
  const resourceIri = `${config.baseUrl}/${path}`;
  const ct = request.headers.get('Content-Type') || '';
  let action, slug, name, content, metadata;

  if (ct.includes('multipart/form-data')) {
    const form = await request.formData();
    action = form.get('action');
    if (action === 'upload') {
      return handleUpload(form, resourceIri, path, config, storage, env);
    }
    name = form.get('name');
    content = form.get('content');
    metadata = form.get('metadata');
  } else {
    const form = await request.formData();
    action = form.get('action');
    name = form.get('name');
    content = form.get('content');
    metadata = form.get('metadata');
  }

  if (action === 'mkdir' && name) {
    const cleanName = name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const newIri = resourceIri + cleanName + '/';
    const containerNt = [
      `<${newIri}> <${PREFIXES.rdf}type> <${PREFIXES.ldp}BasicContainer> .`,
      `<${newIri}> <${PREFIXES.rdf}type> <${PREFIXES.ldp}Container> .`,
    ].join('\n');
    await storage.put(`doc:${newIri}:${newIri}`, containerNt);
    await storage.put(`idx:${newIri}`, JSON.stringify({ subjects: [newIri] }));
    await appendContainment(storage, resourceIri, newIri);
    return redirect(`/storage/${path}`);
  }

  if (action === 'save' && content !== null && content !== undefined) {
    const fileCt = contentTypeForExt(path.split('/').pop());
    if (fileCt === 'text/turtle' || fileCt === 'application/n-triples') {
      const { parseTurtle } = await import('../../rdf/turtle-parser.js');
      const triples = fileCt === 'text/turtle'
        ? parseTurtle(content, resourceIri)
        : parseNTriples(content);
      await writeTriplesToKV(storage, resourceIri, triples);
    } else {
      const binary = new TextEncoder().encode(content);
      await storage.putBlob(`blob:${resourceIri}`, binary.buffer, fileCt);
      await writeMetadata(storage, resourceIri, fileCt, binary.byteLength);
      await storage.put(`idx:${resourceIri}`, JSON.stringify({ subjects: [resourceIri], binary: true }));
    }
    return redirect(`/storage/${path}`);
  }

  if (action === 'save_meta' && metadata !== null && metadata !== undefined) {
    const metaTriples = parseNTriples(metadata);
    const nt = metaTriples.map(t => `${t.subject} ${t.predicate} ${t.object} .`).join('\n');
    await storage.put(`doc:${resourceIri}.meta:${resourceIri}`, nt);
    return redirect(`/storage/${path}`);
  }

  if (action === 'delete') {
    if (path.endsWith('/')) {
      await deleteContainerRecursive(storage, resourceIri, env.APPDATA);
    } else {
      await deleteResource(storage, resourceIri, env.APPDATA);
    }
    const parent = computeParent(resourceIri);
    if (parent) await removeContainment(storage, parent, resourceIri);
    const parentPath = parent ? parent.replace(config.baseUrl + '/', '') : `${config.username}/`;
    return redirect(`/storage/${parentPath}`);
  }

  return redirect(`/storage/${path}`);
}

// ── Upload with metadata capture ─────────────────────

async function handleUpload(form, containerIri, path, config, storage, env) {
  const file = form.get('file');
  const slug = form.get('slug') || file.name;
  const cleanSlug = slug.replace(/[^a-zA-Z0-9._-]/g, '-');
  const newIri = containerIri + cleanSlug;
  const binary = await file.arrayBuffer();
  const fileType = file.type || 'application/octet-stream';

  await storage.putBlob(`blob:${newIri}`, binary, fileType);

  // Capture file metadata
  const now = new Date().toISOString();
  const metaNt = [
    `${iri(newIri)} ${iri(PREFIXES.rdf + 'type')} ${iri(PREFIXES.schema + 'DigitalDocument')} .`,
    `${iri(newIri)} ${iri(PREFIXES.dcterms + 'format')} ${literal(fileType)} .`,
    `${iri(newIri)} ${iri(PREFIXES.dcterms + 'extent')} ${typedLiteral(binary.byteLength, PREFIXES.xsd + 'integer')} .`,
    `${iri(newIri)} ${iri(PREFIXES.dcterms + 'created')} ${typedLiteral(now, PREFIXES.xsd + 'dateTime')} .`,
    `${iri(newIri)} ${iri(PREFIXES.dcterms + 'title')} ${literal(file.name)} .`,
  ];

  if (file.lastModified) {
    metaNt.push(`${iri(newIri)} ${iri(PREFIXES.dcterms + 'modified')} ${typedLiteral(new Date(file.lastModified).toISOString(), PREFIXES.xsd + 'dateTime')} .`);
  }

  await storage.put(`doc:${newIri}.meta:${newIri}`, metaNt.join('\n'));
  await storage.put(`idx:${newIri}`, JSON.stringify({ subjects: [newIri], binary: true }));
  await appendContainment(storage, containerIri, newIri);

  const quotaData = await env.APPDATA.get(`quota:${config.username}`);
  const quota = JSON.parse(quotaData || '{"usedBytes":0}');
  quota.usedBytes += binary.byteLength;
  await env.APPDATA.put(`quota:${config.username}`, JSON.stringify(quota));

  return redirect(`/storage/${path}`);
}

// ── Container listing ────────────────────────────────

async function renderContainerListing(containerIri, config, storage) {
  const ntData = await storage.get(`doc:${containerIri}:${containerIri}`);
  if (!ntData) return '<div class="text-muted">Empty container.</div>';

  const triples = parseNTriples(ntData);
  const ldpContains = PREFIXES.ldp + 'contains';
  const contained = [];
  for (const t of triples) {
    if (unwrapIri(t.predicate) === ldpContains) contained.push(unwrapIri(t.object));
  }
  if (contained.length === 0) return '<div class="text-muted">Empty container.</div>';

  contained.sort((a, b) => {
    const ad = a.endsWith('/') ? 0 : 1, bd = b.endsWith('/') ? 0 : 1;
    return ad !== bd ? ad - bd : a.localeCompare(b);
  });

  const rows = contained.map(uri => {
    const name = uri.replace(containerIri, '');
    const isDir = uri.endsWith('/');
    const sp = uri.replace(config.baseUrl + '/', '');
    return `<tr>
      <td style="width:1.5rem;">${isDir ? '📁' : '📄'}</td>
      <td><a href="/storage/${escapeHtml(sp)}" class="mono">${escapeHtml(name)}</a></td>
      <td style="white-space:nowrap;">
        <a href="/${escapeHtml(sp)}" class="text-muted" target="_blank" style="font-size:0.8rem;">raw</a>
        <form method="POST" action="/storage/${escapeHtml(sp)}" class="inline" style="margin-left:0.5rem;">
          <input type="hidden" name="action" value="delete">
          <button type="submit" class="text-muted" style="background:none;border:none;cursor:pointer;font-size:0.8rem;color:#dc3545;padding:0;"
            onclick="return confirm('Delete ${escapeHtml(name)}?')">delete</button>
        </form>
      </td>
    </tr>`;
  }).join('');

  return `<table>${rows}</table>`;
}

// ── Resource loading ─────────────────────────────────

async function loadResource(resourceIri, storage) {
  const idx = await storage.get(`idx:${resourceIri}`);

  if (idx) {
    const parsed = JSON.parse(idx);
    if (parsed.binary) {
      const blob = await storage.getBlob(`blob:${resourceIri}`);
      const metaDoc = await storage.get(`doc:${resourceIri}.meta:${resourceIri}`);
      let ct = 'application/octet-stream';
      if (metaDoc) {
        const m = metaDoc.match(/"([^"]+)"/);
        if (m) ct = m[1];
      }
      const size = blob ? blob.byteLength : 0;
      // Try to read text content for small text blobs
      let textContent = null;
      if (blob && size < 100000) {
        try { textContent = new TextDecoder().decode(blob); } catch {}
      }
      return { content: textContent, contentType: ct, isBinary: true, size };
    }

    // RDF resource
    const allTriples = [];
    for (const subj of parsed.subjects || []) {
      const nt = await storage.get(`doc:${resourceIri}:${subj}`);
      if (nt) allTriples.push(...parseNTriples(nt));
    }
    if (allTriples.length > 0) {
      const { serializeTurtle } = await import('../../rdf/turtle-serializer.js');
      const text = serializeTurtle(allTriples, ['rdf', 'rdfs', 'ldp', 'foaf', 'solid', 'dcterms', 'acl', 'acp', 'vcard', 'space', 'schema']);
      return { content: text, contentType: 'text/turtle', isBinary: false, size: text.length };
    }
  }

  const blob = await storage.getBlob(`blob:${resourceIri}`);
  if (blob) {
    let text = null;
    try { text = new TextDecoder().decode(blob); } catch {}
    return { content: text, contentType: 'application/octet-stream', isBinary: true, size: blob.byteLength };
  }

  return { content: null, contentType: null, isBinary: false, size: 0 };
}

async function loadMetadata(resourceIri, storage) {
  const nt = await storage.get(`doc:${resourceIri}.meta:${resourceIri}`);
  if (!nt) return [];
  return parseNTriples(nt);
}

// ── Delete helpers ───────────────────────────────────

async function deleteResource(storage, resourceIri, appdata) {
  const idx = await storage.get(`idx:${resourceIri}`);
  if (idx) {
    const parsed = JSON.parse(idx);
    for (const subj of parsed.subjects || []) {
      await storage.delete(`doc:${resourceIri}:${subj}`);
    }
    await storage.delete(`idx:${resourceIri}`);
  }
  try { await storage.deleteBlob(`blob:${resourceIri}`); } catch {}
  await storage.delete(`doc:${resourceIri}.meta:${resourceIri}`);
  await storage.delete(`acl:${resourceIri}`);
  await appdata.delete(`acp:${resourceIri}`);
}

async function deleteContainerRecursive(storage, containerIri, appdata) {
  const ntData = await storage.get(`doc:${containerIri}:${containerIri}`);
  if (ntData) {
    const triples = parseNTriples(ntData);
    for (const t of triples) {
      if (unwrapIri(t.predicate) === PREFIXES.ldp + 'contains') {
        const child = unwrapIri(t.object);
        if (child.endsWith('/')) await deleteContainerRecursive(storage, child, appdata);
        else await deleteResource(storage, child, appdata);
      }
    }
  }
  await deleteResource(storage, containerIri, appdata);
}

async function removeContainment(storage, parentIri, childIri) {
  const docKey = `doc:${parentIri}:${parentIri}`;
  const ntData = await storage.get(docKey);
  if (!ntData) return;
  const triples = parseNTriples(ntData);
  const filtered = triples.filter(t =>
    !(unwrapIri(t.predicate) === PREFIXES.ldp + 'contains' && unwrapIri(t.object) === childIri)
  );
  await storage.put(docKey, serializeNTriples(filtered));
}

// ── Write helpers ────────────────────────────────────

async function writeTriplesToKV(storage, resourceIri, triples) {
  const bySubject = new Map();
  for (const t of triples) {
    const s = t.subject.startsWith('<') && t.subject.endsWith('>') ? t.subject.slice(1, -1) : t.subject;
    if (!bySubject.has(s)) bySubject.set(s, []);
    bySubject.get(s).push(t);
  }
  for (const [subjectIri, st] of bySubject) {
    await storage.put(`doc:${resourceIri}:${subjectIri}`, st.map(t => `${t.subject} ${t.predicate} ${t.object} .`).join('\n'));
  }
  await storage.put(`idx:${resourceIri}`, JSON.stringify({ subjects: [...bySubject.keys()] }));
}

async function writeMetadata(storage, resourceIri, contentType, byteLength) {
  const now = new Date().toISOString();
  const metaNt = [
    `${iri(resourceIri)} ${iri(PREFIXES.dcterms + 'format')} ${literal(contentType)} .`,
    `${iri(resourceIri)} ${iri(PREFIXES.dcterms + 'extent')} ${typedLiteral(byteLength, PREFIXES.xsd + 'integer')} .`,
    `${iri(resourceIri)} ${iri(PREFIXES.dcterms + 'modified')} ${typedLiteral(now, PREFIXES.xsd + 'dateTime')} .`,
  ].join('\n');
  await storage.put(`doc:${resourceIri}.meta:${resourceIri}`, metaNt);
}

async function appendContainment(storage, parentIri, childIri) {
  const containNt = `<${parentIri}> <${PREFIXES.ldp}contains> <${childIri}> .`;
  const docKey = `doc:${parentIri}:${parentIri}`;
  const existing = await storage.get(docKey);
  if (existing) {
    if (!existing.includes(`<${childIri}>`)) await storage.put(docKey, existing + '\n' + containNt);
  } else {
    await storage.put(docKey, containNt);
  }
}

function computeParent(resourceIri) {
  const u = new URL(resourceIri);
  const p = u.pathname;
  const trimmed = p.endsWith('/') ? p.slice(0, -1) : p;
  const last = trimmed.lastIndexOf('/');
  return last <= 0 ? null : `${u.origin}${trimmed.slice(0, last + 1)}`;
}

function renderBreadcrumbs(path) {
  const parts = path.split('/').filter(Boolean);
  let current = '';
  const crumbs = parts.map((part, i) => {
    current += part + '/';
    if (i === parts.length - 1 && !path.endsWith('/')) current = current.slice(0, -1);
    return `<a href="/storage/${escapeHtml(current)}">${escapeHtml(part)}</a>`;
  });
  return `<div style="font-size:0.85rem;">/ ${crumbs.join(' / ')}</div>`;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function redirect(location) {
  return new Response(null, { status: 302, headers: { 'Location': location } });
}
