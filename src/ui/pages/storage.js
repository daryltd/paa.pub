/**
 * Storage browser page: file listing, upload, container creation.
 */
import { htmlPage, htmlResponse, escapeHtml } from '../shell.js';
import { requireAuth } from '../../auth/middleware.js';
import { parseNTriples, unwrapIri } from '../../rdf/ntriples.js';
import { PREFIXES } from '../../rdf/prefixes.js';

/**
 * Handle GET /storage/**
 */
export async function renderStoragePage(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, storage, orchestrator, url } = reqCtx;
  const username = config.username;
  const path = url.pathname.replace(/^\/storage\/?/, '') || `${username}/`;
  const resourceIri = `${config.baseUrl}/${path}`;
  const isDir = path.endsWith('/');

  let listing = '';
  if (isDir) {
    listing = await renderContainerListing(resourceIri, config, orchestrator);
  } else {
    listing = renderResourceInfo(resourceIri, config);
  }

  const body = `
    <h1>Storage</h1>

    <div class="card">
      <div class="text-muted" style="margin-bottom: 0.5rem;">
        Path: <span class="mono">${escapeHtml('/' + path)}</span>
      </div>
      ${renderBreadcrumbs(path, config)}
    </div>

    ${isDir ? `
    <div class="card">
      <h2>Upload File</h2>
      <form method="POST" action="/storage/${escapeHtml(path)}" enctype="multipart/form-data">
        <input type="hidden" name="action" value="upload">
        <div class="form-group">
          <input type="file" name="file" required>
        </div>
        <div class="form-group">
          <input type="text" name="slug" placeholder="Filename (optional, uses original name if empty)">
        </div>
        <button type="submit" class="btn">Upload</button>
      </form>
    </div>

    <div class="card">
      <h2>Create Container</h2>
      <form method="POST" action="/storage/${escapeHtml(path)}">
        <input type="hidden" name="action" value="mkdir">
        <div style="display: flex; gap: 0.5rem;">
          <input type="text" name="name" placeholder="Container name" required style="flex: 1;">
          <button type="submit" class="btn">Create</button>
        </div>
      </form>
    </div>
    ` : ''}

    <div class="card">
      <h2>Contents</h2>
      ${listing}
      ${isDir ? `
        <div style="margin-top: 0.5rem;">
          <a href="/acl/${escapeHtml(path)}" class="btn btn-secondary" style="font-size: 0.8rem;">Edit ACL</a>
        </div>
      ` : `
        <div style="margin-top: 0.5rem; display: flex; gap: 0.5rem;">
          <a href="/${escapeHtml(path)}" class="btn btn-secondary" style="font-size: 0.8rem;" target="_blank">View Raw</a>
          <a href="/acl/${escapeHtml(path)}" class="btn btn-secondary" style="font-size: 0.8rem;">Edit ACL</a>
          <form method="POST" action="/storage/${escapeHtml(path)}" class="inline">
            <input type="hidden" name="action" value="delete">
            <button type="submit" class="btn btn-danger" style="font-size: 0.8rem;" onclick="return confirm('Delete this resource?')">Delete</button>
          </form>
        </div>
      `}
    </div>`;

  return htmlResponse(htmlPage('Storage', body, { user: username, nav: 'storage' }));
}

/**
 * Handle POST /storage/**
 */
export async function handleStorageAction(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { request, config, orchestrator, url } = reqCtx;
  const path = url.pathname.replace(/^\/storage\/?/, '') || `${config.username}/`;
  const resourceIri = `${config.baseUrl}/${path}`;

  const contentType = request.headers.get('Content-Type') || '';
  let action, slug, name;

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    action = form.get('action');
    if (action === 'upload') {
      const file = form.get('file');
      slug = form.get('slug') || file.name;
      const newResourceIri = resourceIri + slug.replace(/[^a-zA-Z0-9._-]/g, '-');
      const binary = await file.arrayBuffer();

      const metadataNquads = [
        `<${newResourceIri}> <${PREFIXES.rdf}type> <${PREFIXES.schema}DigitalDocument> <${newResourceIri}.meta> .`,
        `<${newResourceIri}> <${PREFIXES.dcterms}format> "${file.type || 'application/octet-stream'}" <${newResourceIri}.meta> .`,
        `<${newResourceIri}> <${PREFIXES.dcterms}extent> "${binary.byteLength}"^^<${PREFIXES.xsd}integer> <${newResourceIri}.meta> .`,
      ].join('\n');

      const aclNt = '';
      const result = await orchestrator.uploadBinary(newResourceIri, binary, file.type || 'application/octet-stream', metadataNquads, aclNt, config.webId);

      if (result.type === 'auth_error') return new Response('Forbidden', { status: 403 });

      // Add containment
      const containment = `<${resourceIri}> <${PREFIXES.ldp}contains> <${newResourceIri}> <${resourceIri}> .`;
      await orchestrator.insert(containment, config.webId);

      // Update quota
      await updateQuota(reqCtx.env, config.username, binary.byteLength);

      return new Response(null, { status: 302, headers: { 'Location': `/storage/${path}` } });
    }
    name = form.get('name');
  } else {
    const form = await request.formData();
    action = form.get('action');
    name = form.get('name');
  }

  if (action === 'mkdir' && name) {
    const cleanName = name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const newContainerIri = resourceIri + cleanName + '/';
    const typeQuads = [
      `<${newContainerIri}> <${PREFIXES.rdf}type> <${PREFIXES.ldp}BasicContainer> <${newContainerIri}> .`,
      `<${newContainerIri}> <${PREFIXES.rdf}type> <${PREFIXES.ldp}Container> <${newContainerIri}> .`,
    ].join('\n');
    const containment = `<${resourceIri}> <${PREFIXES.ldp}contains> <${newContainerIri}> <${resourceIri}> .`;
    await orchestrator.insert(typeQuads + '\n' + containment, config.webId);

    return new Response(null, { status: 302, headers: { 'Location': `/storage/${path}` } });
  }

  if (action === 'delete') {
    // Delete via LDP
    const sparql = `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <${resourceIri}> { ?s ?p ?o } }`;
    const existing = await orchestrator.query(sparql, [resourceIri], config.webId);
    if (existing.type === 'query_results') {
      const parsed = JSON.parse(existing.sparql_json);
      if (parsed.results?.bindings?.length > 0) {
        // Build N-Quads for deletion
        const nquads = parsed.results.bindings.map(b => {
          const s = termToNQ(b.s || b.subject);
          const p = termToNQ(b.p || b.predicate);
          const o = termToNQ(b.o || b.object);
          return `${s} ${p} ${o} <${resourceIri}> .`;
        }).join('\n');
        await orchestrator.delete(nquads, config.webId);
      }
    }
    // Remove from parent container
    const parent = resourceIri.endsWith('/') ? resourceIri.slice(0, -1).replace(/\/[^/]+$/, '/') : resourceIri.replace(/\/[^/]+$/, '/');
    const containment = `<${parent}> <${PREFIXES.ldp}contains> <${resourceIri}> <${parent}> .`;
    await orchestrator.delete(containment, config.webId);

    return new Response(null, { status: 302, headers: { 'Location': `/storage/${parent.replace(config.baseUrl + '/', '')}` } });
  }

  return new Response(null, { status: 302, headers: { 'Location': `/storage/${path}` } });
}

async function renderContainerListing(containerIri, config, orchestrator) {
  const sparql = `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <${containerIri}> { ?s ?p ?o } }`;
  const result = await orchestrator.query(sparql, [containerIri], config.webId);

  if (result.type !== 'query_results') return '<div class="text-muted">Unable to list contents.</div>';

  const parsed = JSON.parse(result.sparql_json);
  const bindings = parsed.results?.bindings || [];

  const contained = [];
  for (const b of bindings) {
    const p = (b.p || b.predicate)?.value;
    if (p === PREFIXES.ldp + 'contains') {
      const obj = (b.o || b.object)?.value;
      if (obj) contained.push(obj);
    }
  }

  if (contained.length === 0) return '<div class="text-muted">Empty container.</div>';

  const rows = contained.map(uri => {
    const name = uri.replace(containerIri, '');
    const isDir = uri.endsWith('/');
    const storagePath = uri.replace(config.baseUrl + '/', '');
    return `<tr>
      <td>${isDir ? '📁' : '📄'}</td>
      <td><a href="/storage/${escapeHtml(storagePath)}" class="mono">${escapeHtml(name)}</a></td>
      <td><a href="/${escapeHtml(storagePath)}" class="text-muted" target="_blank" style="font-size: 0.8rem;">raw</a></td>
    </tr>`;
  }).join('');

  return `<table>${rows}</table>`;
}

function renderResourceInfo(resourceIri, config) {
  return `<div class="text-muted">Resource: <span class="mono">${escapeHtml(resourceIri)}</span></div>`;
}

function renderBreadcrumbs(path, config) {
  const parts = path.split('/').filter(Boolean);
  let current = '';
  const crumbs = parts.map((part, i) => {
    current += part + '/';
    const isLast = i === parts.length - 1 && !path.endsWith('/');
    if (isLast) {
      current = current.slice(0, -1); // remove trailing /
    }
    return `<a href="/storage/${escapeHtml(current)}">${escapeHtml(part)}</a>`;
  });
  return `<div style="font-size: 0.85rem;">/ ${crumbs.join(' / ')}</div>`;
}

function termToNQ(term) {
  if (!term) return '""';
  if (term.type === 'uri') return `<${term.value}>`;
  if (term.type === 'bnode') return `_:${term.value}`;
  if (term.type === 'literal' || term.type === 'typed-literal') {
    let nt = `"${term.value}"`;
    if (term['xml:lang']) nt += `@${term['xml:lang']}`;
    else if (term.datatype) nt += `^^<${term.datatype}>`;
    return nt;
  }
  return `"${term.value || ''}"`;
}

async function updateQuota(env, username, addedBytes) {
  const quotaData = await env.APPDATA.get(`quota:${username}`);
  const quota = JSON.parse(quotaData || '{"usedBytes":0}');
  quota.usedBytes += addedBytes;
  await env.APPDATA.put(`quota:${username}`, JSON.stringify(quota));
}
