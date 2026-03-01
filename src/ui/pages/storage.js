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
import { PREFIXES, shortenPredicate, loadMergedPrefixes } from '../../rdf/prefixes.js';
import { checkQuota, quotaExceededResponse, addQuota, subtractQuota } from '../../storage/quota.js';
import { checkContainerQuota, containerQuotaExceededResponse, addContainerBytes, subtractContainerBytes } from '../../storage/container-quota.js';

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
    .map(item => ({ ...item, icon: item.isDir ? '📁' : '📄', copyDefault: computeCopyDefault(item.storagePath) }));
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
  }, { user: username, nav: 'storage', storage, baseUrl: config.baseUrl });
}

// ── Resource page ────────────────────────────────────

async function renderResourcePage(reqCtx, path, resourceIri, username, editMode, editMeta) {
  const { config, storage } = reqCtx;
  const { content, contentType, isBinary, size } = await loadResource(resourceIri, storage);
  const canEdit = isTextResource(path);
  const isHtml = (path.split('.').pop() || '').toLowerCase() === 'html';
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

  // Editable metadata triples for the triple editor widget
  const mergedPrefixes = await loadMergedPrefixes(storage, config.baseUrl, username);
  const metaTriplesEditable = metaTriples.map(t => {
    const predicateIri = unwrapIri(t.predicate);
    let objectValue = t.object;
    if (objectValue.startsWith('"')) objectValue = objectValue.match(/^"([^"]*)"/)?.[1] || objectValue;
    else if (objectValue.startsWith('<')) objectValue = unwrapIri(objectValue);
    return {
      predicate: predicateIri,
      predicateShort: shortenPredicate(predicateIri, mergedPrefixes),
      object: objectValue,
    };
  });

  // Compute dokieli URL — redirect root index.html to paa_custom/index.html
  const isRootIndex = path === `${username}/index.html`;
  const dokieliUrl = isRootIndex
    ? `/${username}/paa_custom/index.html?edit=dokieli`
    : `${resourceUrl}?edit=dokieli`;

  // Pre-compute mutually exclusive display flags for Mustache
  const isImage = isImageType(contentType);
  const showEditor = editMode && canEdit;
  const showImage = !showEditor && isBinary && isImage;
  const showBinaryDownload = !showEditor && isBinary && !isImage;
  const showContent = !showEditor && !isBinary && content !== null;
  const showEmpty = !showEditor && !showImage && !showBinaryDownload && !showContent;

  const copyDefault = computeCopyDefault(path);
  return renderPage('Storage', resourceTemplate, {
    path,
    displayPath: '/' + path,
    breadcrumbs,
    resourceUrl,
    fullResourceUrl: config.baseUrl + resourceUrl,
    fileName,
    copyDefault,
    content,
    contentType,
    sizeFormatted: formatBytes(size),
    showEditor,
    showImage,
    showBinaryDownload,
    showContent,
    showEmpty,
    showEditButton: canEdit && !editMode,
    showDokieliButton: isHtml && !editMode,
    dokieliUrl,
    showMetaEditor: editMeta,
    hasMetaTriples: !editMeta && processedMeta.length > 0,
    showNoMeta: !editMeta && processedMeta.length === 0,
    resourceIri,
    metaTriples: processedMeta,
    metaTriplesEditable,
    metaTurtle,
    prefixesJson: JSON.stringify(mergedPrefixes),
  }, { user: username, nav: 'storage', storage, baseUrl: config.baseUrl });
}

// ── POST /storage/** ─────────────────────────────────

export async function handleStorageAction(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { request, config, storage, env, url } = reqCtx;
  const path = url.pathname.replace(/^\/storage\/?/, '') || `${config.username}/`;
  const resourceIri = `${config.baseUrl}/${path}`;
  const ct = request.headers.get('Content-Type') || '';
  let action, slug, name, content, metadata, destination;

  if (ct.includes('multipart/form-data')) {
    const form = await request.formData();
    action = form.get('action');
    if (action === 'upload') {
      return handleUpload(form, resourceIri, path, config, storage, env);
    }
    name = form.get('name');
    content = form.get('content');
    metadata = form.get('metadata');
    destination = form.get('destination');
  } else {
    const form = await request.formData();
    action = form.get('action');
    name = form.get('name');
    content = form.get('content');
    metadata = form.get('metadata');
    destination = form.get('destination');
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

  if (action === 'move' && destination) {
    return handleMove(resourceIri, destination, path, config, storage, env);
  }

  if (action === 'copy' && destination) {
    return handleCopy(resourceIri, destination, path, config, storage, env);
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

// ── Move & Copy helpers ──────────────────────────────

function computeCopyDefault(storagePath) {
  if (storagePath.endsWith('/')) {
    return storagePath.slice(0, -1) + '-copy/';
  }
  const dot = storagePath.lastIndexOf('.');
  const slash = storagePath.lastIndexOf('/');
  if (dot > slash + 1) {
    return storagePath.slice(0, dot) + '-copy' + storagePath.slice(dot);
  }
  return storagePath + '-copy';
}

function validateDestination(destination, config, sourceIri) {
  if (!destination || !destination.trim()) return { error: 'Destination path is required.' };
  let dest = destination.trim();
  // Strip leading slash
  if (dest.startsWith('/')) dest = dest.slice(1);
  // Must start with username/
  if (!dest.startsWith(config.username + '/')) return { error: 'Destination must be within your pod.' };
  const destIri = `${config.baseUrl}/${dest}`;
  // Cannot move/copy to self
  if (destIri === sourceIri) return { error: 'Destination is the same as source.' };
  // Source and destination must match type (both container or both non-container)
  const sourceIsDir = sourceIri.endsWith('/');
  const destIsDir = dest.endsWith('/');
  if (sourceIsDir !== destIsDir) {
    return { error: sourceIsDir ? 'Destination must end with / for containers.' : 'Destination must not end with / for resources.' };
  }
  return { destIri, destPath: dest };
}

async function computeResourceSize(storage, resourceIri) {
  const metaDoc = await storage.get(`doc:${resourceIri}.meta:${resourceIri}`);
  if (metaDoc) {
    const match = metaDoc.match(/extent">\s*"(\d+)"/);
    if (match) return parseInt(match[1], 10);
    // Try typed literal format
    const m2 = metaDoc.match(/"(\d+)"\^\^/);
    if (m2) return parseInt(m2[1], 10);
  }
  // Fallback: estimate from stored docs
  let size = 0;
  const idx = await storage.get(`idx:${resourceIri}`);
  if (idx) {
    const parsed = JSON.parse(idx);
    if (parsed.binary) {
      const blob = await storage.getBlob(`blob:${resourceIri}`);
      if (blob) size = blob.byteLength;
    } else {
      for (const subj of parsed.subjects || []) {
        const doc = await storage.get(`doc:${resourceIri}:${subj}`);
        if (doc) size += new TextEncoder().encode(doc).byteLength;
      }
    }
  }
  return size;
}

async function computeContainerSizeRecursive(storage, containerIri) {
  let total = 0;
  const ntData = await storage.get(`doc:${containerIri}:${containerIri}`);
  if (ntData) {
    const triples = parseNTriples(ntData);
    for (const t of triples) {
      if (unwrapIri(t.predicate) === PREFIXES.ldp + 'contains') {
        const child = unwrapIri(t.object);
        if (child.endsWith('/')) {
          total += await computeContainerSizeRecursive(storage, child);
        } else {
          total += await computeResourceSize(storage, child);
        }
      }
    }
  }
  return total;
}

async function ensureParentContainersLocal(storage, destIri) {
  const parent = computeParent(destIri);
  if (!parent) return;
  const idx = await storage.get(`idx:${parent}`);
  if (idx) return; // Parent already exists
  // Recursively ensure ancestors first
  await ensureParentContainersLocal(storage, parent);
  // Create this container
  const containerNt = [
    `<${parent}> <${PREFIXES.rdf}type> <${PREFIXES.ldp}BasicContainer> .`,
    `<${parent}> <${PREFIXES.rdf}type> <${PREFIXES.ldp}Container> .`,
  ].join('\n');
  await storage.put(`doc:${parent}:${parent}`, containerNt);
  await storage.put(`idx:${parent}`, JSON.stringify({ subjects: [parent] }));
  // Add containment in grandparent
  const grandparent = computeParent(parent);
  if (grandparent) await appendContainment(storage, grandparent, parent);
}

async function moveSingleResource(storage, sourceIri, destIri, appdata) {
  const idx = await storage.get(`idx:${sourceIri}`);
  if (!idx) return;
  const parsed = JSON.parse(idx);

  if (parsed.binary) {
    // Copy blob
    const blob = await storage.getBlob(`blob:${sourceIri}`);
    if (blob) {
      const metaDoc = await storage.get(`doc:${sourceIri}.meta:${sourceIri}`);
      let ct = 'application/octet-stream';
      if (metaDoc) {
        const m = metaDoc.match(/"([^"]+)"/);
        if (m) ct = m[1];
      }
      await storage.putBlob(`blob:${destIri}`, blob, ct);
      await storage.deleteBlob(`blob:${sourceIri}`);
    }
  }

  // Copy doc keys with subject remapping
  const newSubjects = [];
  for (const subj of parsed.subjects || []) {
    const doc = await storage.get(`doc:${sourceIri}:${subj}`);
    if (doc) {
      const newSubj = subj === sourceIri ? destIri : subj;
      const newDoc = subj === sourceIri ? doc.replaceAll(`<${sourceIri}>`, `<${destIri}>`) : doc;
      await storage.put(`doc:${destIri}:${newSubj}`, newDoc);
      newSubjects.push(newSubj);
      await storage.delete(`doc:${sourceIri}:${subj}`);
    }
  }
  await storage.put(`idx:${destIri}`, JSON.stringify({ subjects: newSubjects, ...(parsed.binary ? { binary: true } : {}) }));
  await storage.delete(`idx:${sourceIri}`);

  // Copy and rewrite metadata
  const metaDoc = await storage.get(`doc:${sourceIri}.meta:${sourceIri}`);
  if (metaDoc) {
    const newMeta = metaDoc.replaceAll(`<${sourceIri}>`, `<${destIri}>`);
    await storage.put(`doc:${destIri}.meta:${destIri}`, newMeta);
    await storage.delete(`doc:${sourceIri}.meta:${sourceIri}`);
  }

  // Move ACL and ACP
  const acl = await storage.get(`acl:${sourceIri}`);
  if (acl) {
    await storage.put(`acl:${destIri}`, acl);
    await storage.delete(`acl:${sourceIri}`);
  }
  const acp = await appdata.get(`acp:${sourceIri}`);
  if (acp) {
    await appdata.put(`acp:${destIri}`, acp);
    await appdata.delete(`acp:${sourceIri}`);
  }
}

async function moveContainerRecursive(storage, sourceIri, destIri, appdata) {
  // First, move all children
  const ntData = await storage.get(`doc:${sourceIri}:${sourceIri}`);
  if (ntData) {
    const triples = parseNTriples(ntData);
    for (const t of triples) {
      if (unwrapIri(t.predicate) === PREFIXES.ldp + 'contains') {
        const childIri = unwrapIri(t.object);
        const childSuffix = childIri.slice(sourceIri.length);
        const newChildIri = destIri + childSuffix;
        if (childIri.endsWith('/')) {
          await moveContainerRecursive(storage, childIri, newChildIri, appdata);
        } else {
          await moveSingleResource(storage, childIri, newChildIri, appdata);
        }
      }
    }
  }

  // Move the container itself (its doc keys, metadata, ACL/ACP)
  const idx = await storage.get(`idx:${sourceIri}`);
  if (idx) {
    const parsed = JSON.parse(idx);
    const newSubjects = [];
    for (const subj of parsed.subjects || []) {
      const doc = await storage.get(`doc:${sourceIri}:${subj}`);
      if (doc) {
        const newSubj = subj === sourceIri ? destIri : subj;
        // Rewrite containment triples: old child IRIs → new
        let newDoc = doc.replaceAll(`<${sourceIri}>`, `<${destIri}>`);
        // Also rewrite child references in containment triples
        if (subj === sourceIri) {
          // Replace all child IRI references that start with sourceIri
          const childPrefix = sourceIri;
          // Match <sourceIri...> patterns in containment triples
          newDoc = newDoc.replaceAll(childPrefix, destIri);
        }
        await storage.put(`doc:${destIri}:${newSubj}`, newDoc);
        newSubjects.push(newSubj);
        await storage.delete(`doc:${sourceIri}:${subj}`);
      }
    }
    await storage.put(`idx:${destIri}`, JSON.stringify({ subjects: newSubjects }));
    await storage.delete(`idx:${sourceIri}`);
  }

  // Metadata
  const metaDoc = await storage.get(`doc:${sourceIri}.meta:${sourceIri}`);
  if (metaDoc) {
    await storage.put(`doc:${destIri}.meta:${destIri}`, metaDoc.replaceAll(`<${sourceIri}>`, `<${destIri}>`));
    await storage.delete(`doc:${sourceIri}.meta:${sourceIri}`);
  }

  // ACL/ACP
  const acl = await storage.get(`acl:${sourceIri}`);
  if (acl) { await storage.put(`acl:${destIri}`, acl); await storage.delete(`acl:${sourceIri}`); }
  const acp = await appdata.get(`acp:${sourceIri}`);
  if (acp) { await appdata.put(`acp:${destIri}`, acp); await appdata.delete(`acp:${sourceIri}`); }
}

async function copySingleResource(storage, sourceIri, destIri) {
  const idx = await storage.get(`idx:${sourceIri}`);
  if (!idx) return;
  const parsed = JSON.parse(idx);

  if (parsed.binary) {
    const blob = await storage.getBlob(`blob:${sourceIri}`);
    if (blob) {
      const metaDoc = await storage.get(`doc:${sourceIri}.meta:${sourceIri}`);
      let ct = 'application/octet-stream';
      if (metaDoc) {
        const m = metaDoc.match(/"([^"]+)"/);
        if (m) ct = m[1];
      }
      await storage.putBlob(`blob:${destIri}`, blob, ct);
    }
  }

  // Copy doc keys
  const newSubjects = [];
  for (const subj of parsed.subjects || []) {
    const doc = await storage.get(`doc:${sourceIri}:${subj}`);
    if (doc) {
      const newSubj = subj === sourceIri ? destIri : subj;
      const newDoc = subj === sourceIri ? doc.replaceAll(`<${sourceIri}>`, `<${destIri}>`) : doc;
      await storage.put(`doc:${destIri}:${newSubj}`, newDoc);
      newSubjects.push(newSubj);
    }
  }
  await storage.put(`idx:${destIri}`, JSON.stringify({ subjects: newSubjects, ...(parsed.binary ? { binary: true } : {}) }));

  // Copy and rewrite metadata (no ACP/ACL copy)
  const metaDoc = await storage.get(`doc:${sourceIri}.meta:${sourceIri}`);
  if (metaDoc) {
    await storage.put(`doc:${destIri}.meta:${destIri}`, metaDoc.replaceAll(`<${sourceIri}>`, `<${destIri}>`));
  }
}

async function copyContainerRecursive(storage, sourceIri, destIri) {
  // Copy all children
  const ntData = await storage.get(`doc:${sourceIri}:${sourceIri}`);
  if (ntData) {
    const triples = parseNTriples(ntData);
    for (const t of triples) {
      if (unwrapIri(t.predicate) === PREFIXES.ldp + 'contains') {
        const childIri = unwrapIri(t.object);
        const childSuffix = childIri.slice(sourceIri.length);
        const newChildIri = destIri + childSuffix;
        if (childIri.endsWith('/')) {
          await copyContainerRecursive(storage, childIri, newChildIri);
        } else {
          await copySingleResource(storage, childIri, newChildIri);
        }
      }
    }
  }

  // Copy the container itself
  const idx = await storage.get(`idx:${sourceIri}`);
  if (idx) {
    const parsed = JSON.parse(idx);
    const newSubjects = [];
    for (const subj of parsed.subjects || []) {
      const doc = await storage.get(`doc:${sourceIri}:${subj}`);
      if (doc) {
        const newSubj = subj === sourceIri ? destIri : subj;
        let newDoc = doc.replaceAll(`<${sourceIri}>`, `<${destIri}>`);
        if (subj === sourceIri) {
          newDoc = newDoc.replaceAll(sourceIri, destIri);
        }
        await storage.put(`doc:${destIri}:${newSubj}`, newDoc);
        newSubjects.push(newSubj);
      }
    }
    await storage.put(`idx:${destIri}`, JSON.stringify({ subjects: newSubjects }));
  }

  // Copy metadata (no ACP/ACL)
  const metaDoc = await storage.get(`doc:${sourceIri}.meta:${sourceIri}`);
  if (metaDoc) {
    await storage.put(`doc:${destIri}.meta:${destIri}`, metaDoc.replaceAll(`<${sourceIri}>`, `<${destIri}>`));
  }
}

async function handleMove(resourceIri, destination, path, config, storage, env) {
  const v = validateDestination(destination, config, resourceIri);
  if (v.error) return errorResponse(v.error, 400);

  const isDir = path.endsWith('/');

  // Cycle detection for containers
  if (isDir && v.destIri.startsWith(resourceIri)) {
    return errorResponse('Cannot move a container into its own subtree.', 400);
  }

  // Check destination doesn't exist
  const destIdx = await storage.get(`idx:${v.destIri}`);
  if (destIdx) return errorResponse('Destination already exists.', 409);

  // Compute size for quota adjustment
  const size = isDir
    ? await computeContainerSizeRecursive(storage, resourceIri)
    : await computeResourceSize(storage, resourceIri);

  // Ensure parent containers exist
  await ensureParentContainersLocal(storage, v.destIri);

  // Execute move
  if (isDir) {
    await moveContainerRecursive(storage, resourceIri, v.destIri, env.APPDATA);
  } else {
    await moveSingleResource(storage, resourceIri, v.destIri, env.APPDATA);
  }

  // Update containment: remove from old parent, add to new parent
  const oldParent = computeParent(resourceIri);
  if (oldParent) await removeContainment(storage, oldParent, resourceIri);
  const newParent = computeParent(v.destIri);
  if (newParent) await appendContainment(storage, newParent, v.destIri);

  // Adjust container quotas: subtract from old hierarchy, add to new hierarchy
  if (oldParent) await subtractContainerBytes(env.APPDATA, oldParent, size);
  if (newParent) await addContainerBytes(env.APPDATA, newParent, size);

  return redirect(`/storage/${v.destPath}`);
}

async function handleCopy(resourceIri, destination, path, config, storage, env) {
  const v = validateDestination(destination, config, resourceIri);
  if (v.error) return errorResponse(v.error, 400);

  const isDir = path.endsWith('/');

  // Check destination doesn't exist
  const destIdx = await storage.get(`idx:${v.destIri}`);
  if (destIdx) return errorResponse('Destination already exists.', 409);

  // Compute size for quota check
  const size = isDir
    ? await computeContainerSizeRecursive(storage, resourceIri)
    : await computeResourceSize(storage, resourceIri);

  // Quota checks
  const quotaResult = await checkQuota(env.APPDATA, config.username, size, config.storageLimit);
  if (!quotaResult.allowed) return quotaExceededResponse(quotaResult.usedBytes, quotaResult.limitBytes);
  const newParent = computeParent(v.destIri);
  if (newParent) {
    const cqResult = await checkContainerQuota(env.APPDATA, newParent, size);
    if (!cqResult.allowed) return containerQuotaExceededResponse(cqResult.blockedBy, cqResult.usedBytes, cqResult.limitBytes);
  }

  // Ensure parent containers exist
  await ensureParentContainersLocal(storage, v.destIri);

  // Execute copy
  if (isDir) {
    await copyContainerRecursive(storage, resourceIri, v.destIri);
  } else {
    await copySingleResource(storage, resourceIri, v.destIri);
  }

  // Add containment in new parent
  if (newParent) await appendContainment(storage, newParent, v.destIri);

  // Update quotas
  await addQuota(env.APPDATA, config.username, size);
  if (newParent) await addContainerBytes(env.APPDATA, newParent, size);

  return redirect(`/storage/${v.destPath}`);
}

function errorResponse(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function redirect(location) {
  return new Response(null, { status: 302, headers: { 'Location': location } });
}
