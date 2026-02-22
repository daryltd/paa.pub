/**
 * Storage browser — the web UI for managing Solid pod contents.
 *
 * Routes:
 *   GET  /storage/**  — render a container listing or resource detail page
 *   POST /storage/**  — handle actions: upload, mkdir, create, save, delete
 *
 * Features:
 *   - Container pages show: file listing with icons, upload form, create
 *     container form, create text resource form, delete buttons
 *   - Resource pages show: content preview (text/image/binary), raw download
 *     link, edit form (for text resources), metadata table, delete button
 *   - Metadata editing: Dublin Core triples (format, extent, created, title)
 *     stored in `doc:{iri}.meta:{iri}` as N-Triples
 *   - Recursive container deletion with quota tracking
 *
 * Storage keys used:
 *   - `idx:{iri}` — resource index (JSON with subjects array, binary flag)
 *   - `doc:{iri}:{subject}` — RDF triple documents
 *   - `doc:{iri}.meta:{iri}` — resource metadata
 *   - `blob:{iri}` — binary file data (R2)
 *   - `quota:{username}` — storage usage counter
 */
import { renderPage, renderPartial } from '../shell.js';
import containerTemplate from '../templates/storage-container.html';
import resourceTemplate from '../templates/storage-resource.html';
import breadcrumbsPartial from '../templates/partials/breadcrumbs.html';
import { requireAuth } from '../../auth/middleware.js';
import { parseNTriples, unwrapIri, serializeNTriples, iri, literal, typedLiteral } from '../../rdf/ntriples.js';
import { PREFIXES } from '../../rdf/prefixes.js';
import { checkQuota, quotaExceededResponse, addQuota } from '../../storage/quota.js';
import { checkContainerQuota, containerQuotaExceededResponse, addContainerBytes } from '../../storage/container-quota.js';

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
  const items = (await loadContainerItems(resourceIri, config, storage))
    .map(item => ({ ...item, icon: item.isDir ? '📁' : '📄' }));
  const isRoot = path === `${username}/`;
  const crumbs = buildBreadcrumbs(path);
  const breadcrumbs = renderPartial(breadcrumbsPartial, { crumbs });

  return renderPage('Storage', containerTemplate, {
    path,
    displayPath: '/' + path,
    breadcrumbs,
    items,
    hasItems: items.length > 0,
    isRoot,
  }, { user: username, nav: 'storage' });
}

// ── Resource page ────────────────────────────────────

async function renderResourcePage(reqCtx, path, resourceIri, username, editMode, editMeta) {
  const { config, storage } = reqCtx;
  const { content, contentType, isBinary, size } = await loadResource(resourceIri, storage);
  const canEdit = isTextResource(path);
  const resourceUrl = `/${path}`;
  const fileName = path.split('/').pop();
  const crumbs = buildBreadcrumbs(path);
  const breadcrumbs = renderPartial(breadcrumbsPartial, { crumbs });

  // Metadata
  const metaTriples = await loadMetadata(resourceIri, storage);
  const metaTurtle = metaTriples.length > 0
    ? metaTriples.map(t => `${t.subject} ${t.predicate} ${t.object} .`).join('\n')
    : '';

  // Pre-process metadata for display
  const processedMeta = metaTriples.map(t => {
    const predLabel = unwrapIri(t.predicate).split(/[#/]/).pop();
    let value = t.object;
    if (value.startsWith('"')) value = value.match(/^"([^"]*)"/)?.[1] || value;
    else if (value.startsWith('<')) value = unwrapIri(value);
    return { predLabel, value };
  });

  // Pre-compute mutually exclusive display flags for Mustache
  const isImage = isImageType(contentType);
  const showEditor = editMode && canEdit;
  const showImage = !showEditor && isBinary && isImage;
  const showBinaryDownload = !showEditor && isBinary && !isImage;
  const showContent = !showEditor && !isBinary && content !== null;
  const showEmpty = !showEditor && !showImage && !showBinaryDownload && !showContent;

  return renderPage('Storage', resourceTemplate, {
    path,
    displayPath: '/' + path,
    breadcrumbs,
    resourceUrl,
    fullResourceUrl: config.baseUrl + resourceUrl,
    fileName,
    content,
    contentType,
    sizeFormatted: formatBytes(size),
    showEditor,
    showImage,
    showBinaryDownload,
    showContent,
    showEmpty,
    showEditButton: canEdit && !editMode,
    showMetaEditor: editMeta,
    hasMetaTriples: !editMeta && processedMeta.length > 0,
    showNoMeta: !editMeta && processedMeta.length === 0,
    resourceIri,
    metaTriples: processedMeta,
    metaTurtle,
  }, { user: username, nav: 'storage' });
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

  if (action === 'create' && name) {
    const cleanName = name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const newIri = resourceIri + cleanName;
    const fileCt = contentTypeForExt(cleanName);
    const text = content || '';
    const textBytes = new TextEncoder().encode(text).byteLength;

    // Quota check
    const quotaResult = await checkQuota(env.APPDATA, config.username, textBytes, config.storageLimit);
    if (!quotaResult.allowed) return quotaExceededResponse(quotaResult.usedBytes, quotaResult.limitBytes);
    const cqResult = await checkContainerQuota(env.APPDATA, resourceIri, textBytes);
    if (!cqResult.allowed) return containerQuotaExceededResponse(cqResult.blockedBy, cqResult.usedBytes, cqResult.limitBytes);

    if (fileCt === 'text/turtle' || fileCt === 'application/n-triples') {
      const { parseTurtle } = await import('../../rdf/turtle-parser.js');
      const triples = fileCt === 'text/turtle'
        ? parseTurtle(text, newIri)
        : parseNTriples(text);
      await writeTriplesToKV(storage, newIri, triples);
    } else {
      const binary = new TextEncoder().encode(text);
      await storage.putBlob(`blob:${newIri}`, binary.buffer, fileCt);
      await writeMetadata(storage, newIri, fileCt, binary.byteLength);
      await storage.put(`idx:${newIri}`, JSON.stringify({ subjects: [newIri], binary: true }));
    }
    await appendContainment(storage, resourceIri, newIri);

    // Update quota tracking
    await addQuota(env.APPDATA, config.username, textBytes);
    await addContainerBytes(env.APPDATA, resourceIri, textBytes);

    return redirect(`/storage/${path}${cleanName}`);
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

  // Quota checks before writing
  const quotaResult = await checkQuota(env.APPDATA, config.username, binary.byteLength, config.storageLimit);
  if (!quotaResult.allowed) return quotaExceededResponse(quotaResult.usedBytes, quotaResult.limitBytes);
  const cqResult = await checkContainerQuota(env.APPDATA, containerIri, binary.byteLength);
  if (!cqResult.allowed) return containerQuotaExceededResponse(cqResult.blockedBy, cqResult.usedBytes, cqResult.limitBytes);

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

  // Update quota tracking
  await addQuota(env.APPDATA, config.username, binary.byteLength);
  await addContainerBytes(env.APPDATA, containerIri, binary.byteLength);

  return redirect(`/storage/${path}`);
}

// ── Container listing data ───────────────────────────

async function loadContainerItems(containerIri, config, storage) {
  const ntData = await storage.get(`doc:${containerIri}:${containerIri}`);
  if (!ntData) return [];

  const triples = parseNTriples(ntData);
  const ldpContains = PREFIXES.ldp + 'contains';
  const contained = [];
  for (const t of triples) {
    if (unwrapIri(t.predicate) === ldpContains) contained.push(unwrapIri(t.object));
  }
  if (contained.length === 0) return [];

  contained.sort((a, b) => {
    const ad = a.endsWith('/') ? 0 : 1, bd = b.endsWith('/') ? 0 : 1;
    return ad !== bd ? ad - bd : a.localeCompare(b);
  });

  return contained.map(uri => {
    const name = uri.replace(containerIri, '');
    const isDir = uri.endsWith('/');
    const storagePath = uri.replace(config.baseUrl + '/', '');
    return { name, isDir, storagePath, rawPath: storagePath };
  });
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

function buildBreadcrumbs(path) {
  const parts = path.split('/').filter(Boolean);
  let current = '';
  return parts.map((part, i) => {
    current += part + '/';
    if (i === parts.length - 1 && !path.endsWith('/')) current = current.slice(0, -1);
    return { href: current, label: part, notFirst: i > 0 };
  });
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
