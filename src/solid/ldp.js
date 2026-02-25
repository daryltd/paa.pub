/**
 * Linked Data Platform (LDP) protocol handler.
 *
 * This is the core Solid protocol implementation. It handles all HTTP methods
 * (GET, PUT, POST, PATCH, DELETE) for resources under /{username}/.
 *
 * Resource types:
 *   - **RDF resources** — stored as N-Triples in KV, grouped by subject.
 *     Each resource has an `idx:{iri}` index entry listing its subjects,
 *     and `doc:{iri}:{subject}` entries containing the actual triples.
 *   - **Binary resources** — stored as blobs in R2 at `blob:{iri}`, with
 *     metadata in `doc:{iri}.meta:{iri}` and `idx:{iri}` marked `binary: true`.
 *   - **Containers** — RDF resources whose IRI ends with `/`. Container
 *     membership is tracked via `ldp:contains` triples in the container's
 *     own document (`doc:{containerIri}:{containerIri}`).
 *
 * Access control:
 *   All GET/HEAD requests run through `checkAcpAccess()` which evaluates
 *   the ACP policy for the resource, walking up the container hierarchy
 *   if the resource inherits its policy. Responses include Cache-Control
 *   headers based on the access level (public vs private).
 *
 * Special cases:
 *   - `.acl` suffixed URLs → WAC ACL management (delegated to acl.js)
 *   - `.acr` suffixed URLs → ACP editor redirect
 *   - Container root + `Accept: text/html` → serves index.html blob if present
 *   - Root container index.html → Mustache-rendered with WebID profile data
 */
import Mustache from 'mustache';
import { negotiateType, serializeRdf, wantsActivityPub } from './conneg.js';
import { solidHeaders, buildWacAllow } from './headers.js';
import { parseTurtle } from '../rdf/turtle-parser.js';
import { parseNTriples, serializeNQuads, iri, unwrapIri, unwrapLiteral } from '../rdf/ntriples.js';
import { isContainer, slugToName, addContainment, containerTypeQuads, parentContainer } from './containers.js';
import { handleAclGet, handleAclPut, handleAclPatch, handleAclDelete, defaultAclNTriples } from './acl.js';
import { checkAcpAccess } from '../ui/pages/acl-editor.js';
import { PREFIXES } from '../rdf/prefixes.js';
import { checkQuota, quotaExceededResponse, addQuota } from '../storage/quota.js';
import { checkContainerQuota, containerQuotaExceededResponse, addContainerBytes } from '../storage/container-quota.js';
import { checkAppWritePermission } from './app-permissions.js';

const RDF_TYPES = new Set([
  'text/turtle',
  'application/ld+json',
  'application/n-triples',
  'application/n-quads',
  'application/sparql-update',
]);

const BINARY_INDICATOR_TYPES = [
  'image/', 'video/', 'audio/', 'application/pdf', 'application/zip',
  'application/octet-stream', 'application/gzip',
];

/** Check if a Content-Type should be treated as a binary upload (not RDF). */
function isBinaryType(contentType) {
  if (!contentType) return false;
  return BINARY_INDICATOR_TYPES.some(t => contentType.startsWith(t));
}

/**
 * Main LDP handler — dispatches by HTTP method.
 */
export async function handleLDP(reqCtx) {
  const { request, url, config } = reqCtx;
  const resourceIri = `${config.baseUrl}${url.pathname}`;

  // Handle .acl resources (WAC compatibility)
  if (url.pathname.endsWith('.acl')) {
    const baseIri = resourceIri.slice(0, -4);
    switch (request.method) {
      case 'GET': case 'HEAD': return handleAclGet(reqCtx, baseIri);
      case 'PUT': return handleAclPut(reqCtx, baseIri);
      case 'PATCH': return handleAclPatch(reqCtx, baseIri);
      case 'DELETE': return handleAclDelete(reqCtx, baseIri);
      default: return new Response('Method Not Allowed', { status: 405 });
    }
  }

  // Handle .acr resources (ACP)
  if (url.pathname.endsWith('.acr')) {
    if (reqCtx.user !== config.username) {
      return new Response('Forbidden', { status: 403 });
    }
    const baseIri = resourceIri.slice(0, -4);
    if (request.method === 'GET' || request.method === 'HEAD') {
      const { checkAcpAccess: _, ...mod } = await import('../ui/pages/acl-editor.js');
      // Redirect to the ACP editor UI
      return new Response(null, { status: 302, headers: { 'Location': `/acp/${url.pathname.slice(1).replace(/\.acr$/, '')}` } });
    }
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Content negotiation for HTML — serve index.html from container if it exists
  const accept = request.headers.get('Accept') || '';
  if ((request.method === 'GET' || request.method === 'HEAD') && isContainer(resourceIri) && accept.includes('text/html') && !wantsActivityPub(accept)) {
    const indexIri = resourceIri + 'index.html';
    const indexBlob = await reqCtx.storage.getBlob(`blob:${indexIri}`);
    if (indexBlob) {
      // Check ACP on the index.html resource
      const agent = reqCtx.user ? config.webId : null;
      const access = await checkAcpAccess(reqCtx.env.APPDATA, indexIri, agent, config.webId, config.username);
      if (!access.readable) {
        return denyAccess(agent, config.baseUrl);
      }
      let htmlContent = new Uint8Array(indexBlob);

      // For the root container, render index.html through Mustache with profile data
      const rootContainerIri = `${config.baseUrl}/${config.username}/`;
      if (resourceIri === rootContainerIri) {
        try {
          const profileData = await buildProfileTemplateData(reqCtx.storage, config);
          const templateStr = new TextDecoder().decode(htmlContent);
          const rendered = Mustache.render(templateStr, profileData);
          htmlContent = new TextEncoder().encode(rendered);
        } catch (e) {
          console.error('Mustache render error for root index.html:', e);
          // Fall through to serve raw blob on error
        }
      }

      const htmlHeaders = new Headers();
      htmlHeaders.set('Content-Type', 'text/html; charset=utf-8');
      htmlHeaders.set('Cache-Control', access.listed ? 'public, no-cache' : 'private, no-store');
      htmlHeaders.set('X-Content-Type-Options', 'nosniff');
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: htmlHeaders });
      return new Response(htmlContent, { status: 200, headers: htmlHeaders });
    }
    // Fall through to container RDF listing
  }

  switch (request.method) {
    case 'GET': case 'HEAD': return handleGet(reqCtx, resourceIri);
    case 'PUT': return handlePut(reqCtx, resourceIri);
    case 'POST': return handlePost(reqCtx, resourceIri);
    case 'PATCH': return handlePatch(reqCtx, resourceIri);
    case 'DELETE': return handleDelete(reqCtx, resourceIri);
    case 'OPTIONS': return handleOptions(reqCtx, resourceIri);
    default: return new Response('Method Not Allowed', { status: 405 });
  }
}

/**
 * Handle GET/HEAD requests for a resource.
 *
 * Flow:
 *   1. Look up `idx:{iri}` — if missing, check for an orphan blob in R2
 *   2. Run ACP access check (owner is handled inside checkAcpAccess)
 *   3. If binary (idx.binary === true) → fetch blob from R2, read content-type
 *      from metadata, serve with appropriate Cache-Control
 *   4. If RDF → fetch all subject documents in parallel, parse N-Triples,
 *      content-negotiate (Turtle, JSON-LD, N-Triples), serialize and serve
 */
async function handleGet(reqCtx, resourceIri) {
  const { request, config, storage, env } = reqCtx;
  const agent = reqCtx.user ? config.webId : null;

  // Check if the resource exists in KV
  const idx = await storage.get(`idx:${resourceIri}`);
  if (!idx) {
    // Also check for blobs without an idx entry
    const blob = await storage.getBlob(`blob:${resourceIri}`);
    if (!blob) return new Response('Not Found', { status: 404 });

    // Serve orphan blob — always check ACP (owner handled inside checkAcpAccess)
    const access = await checkAcpAccess(env.APPDATA, resourceIri, agent, config.webId, config.username);
    if (!access.readable) {
      return denyAccess(agent, config.baseUrl);
    }
    const headers = solidHeaders(resourceIri, false);
    headers.set('Content-Type', 'application/octet-stream');
    headers.set('Cache-Control', 'private, no-store');
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(blob, { status: 200, headers });
  }

  // Check ACP access — always run (owner is handled inside checkAcpAccess)
  const access = await checkAcpAccess(env.APPDATA, resourceIri, agent, config.webId, config.username);
  if (!access.readable) {
    return denyAccess(agent, config.baseUrl);
  }

  const isOwner = reqCtx.user === config.username;
  const wacAllow = isOwner
    ? buildWacAllow({ user: ['read', 'write', 'append', 'control'], public: [] })
    : buildWacAllow({ user: agent ? ['read'] : [], public: [] });

  const parsed = JSON.parse(idx);

  // Serve binary resources (idx has binary: true)
  if (parsed.binary) {
    const blob = await storage.getBlob(`blob:${resourceIri}`);
    if (!blob) return new Response('Not Found', { status: 404 });
    // Read content type from metadata
    const metaDoc = await storage.get(`doc:${resourceIri}.meta:${resourceIri}`);
    let ct = 'application/octet-stream';
    if (metaDoc) {
      const fmtMatch = metaDoc.match(/"([^"]+)"/);
      if (fmtMatch) ct = fmtMatch[1];
    }
    const headers = solidHeaders(resourceIri, false);
    headers.set('Content-Type', ct);
    headers.set('WAC-Allow', wacAllow);
    headers.set('Cache-Control', access.listed ? 'public, max-age=300' : 'private, no-store');
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(blob, { status: 200, headers });
  }

  // Read RDF triples (parallel fetch)
  const docs = await Promise.all(
    (parsed.subjects || []).map(subj => storage.get(`doc:${resourceIri}:${subj}`))
  );
  const allTriples = [];
  for (const nt of docs) {
    if (nt) allTriples.push(...parseNTriples(nt));
  }

  if (allTriples.length === 0) {
    return new Response('Not Found', { status: 404 });
  }

  const accept = request.headers.get('Accept') || 'text/turtle';
  const contentType = negotiateType(accept);
  const body = serializeRdf(allTriples, contentType);

  const headers = solidHeaders(resourceIri, isContainer(resourceIri));
  headers.set('Content-Type', contentType);
  headers.set('WAC-Allow', wacAllow);
  headers.set('Cache-Control', access.listed ? 'public, max-age=300' : 'private, no-store');

  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(body, { status: 200, headers });
}

/**
 * Handle PUT — create or replace a resource.
 *
 * Binary content types → stored via orchestrator.uploadBinary() to R2.
 * RDF content types → parsed to triples, old triples deleted, new ones written to KV.
 * Creates parent containers if they don't exist.
 */
async function handlePut(reqCtx, resourceIri) {
  const { request, orchestrator, config, storage, env } = reqCtx;
  const agent = reqCtx.user ? config.webId : null;
  const contentType = request.headers.get('Content-Type') || 'application/octet-stream';

  if (!agent) {
    console.log(`[ldp] PUT ${resourceIri} rejected: no authenticated agent`);
    return new Response('Unauthorized', { status: 401 });
  }

  // App write permission check (OIDC apps only)
  if (reqCtx.authMethod === 'oidc' && reqCtx.clientId) {
    const allowed = await checkAppWritePermission(env.APPDATA, config.username, reqCtx.clientId, resourceIri);
    if (!allowed) {
      console.log(`[ldp] PUT ${resourceIri} rejected: app ${reqCtx.clientId} not authorized`);
      return new Response('Forbidden — app not authorized for this container', { status: 403 });
    }
  }

  console.log(`[ldp] PUT ${resourceIri} by ${agent} ct=${contentType}`);

  if (isBinaryType(contentType)) {
    const binary = await request.arrayBuffer();

    // Quota checks
    const quotaResult = await checkQuota(env.APPDATA, config.username, binary.byteLength, config.storageLimit);
    if (!quotaResult.allowed) return quotaExceededResponse(quotaResult.usedBytes, quotaResult.limitBytes);
    const parent = parentContainer(resourceIri);
    if (parent) {
      const cqResult = await checkContainerQuota(env.APPDATA, parent, binary.byteLength);
      if (!cqResult.allowed) return containerQuotaExceededResponse(cqResult.blockedBy, cqResult.usedBytes, cqResult.limitBytes);
    }

    const metadataNquads = buildMetadataNQuads(resourceIri, contentType, binary.byteLength);
    const aclNt = defaultAclNTriples(resourceIri, config.webId);
    const result = await orchestrator.uploadBinary(resourceIri, binary, contentType, metadataNquads, aclNt, agent);
    if (result.type === 'auth_error') return new Response('Forbidden', { status: 403 });
    if (result.type === 'validation_error') return new Response(result.report_json, { status: 422 });

    // Update quota tracking
    await addQuota(env.APPDATA, config.username, binary.byteLength);
    if (parent) await addContainerBytes(env.APPDATA, parent, binary.byteLength);

    return new Response(null, { status: 201, headers: { 'Location': resourceIri } });
  }

  // RDF content
  const body = await request.text();
  const triples = parseBody(body, contentType, resourceIri);

  // For containers, ensure container type triples are present
  if (isContainer(resourceIri)) {
    const hasContainerType = triples.some(t =>
      t.predicate.includes('type') && t.object.includes('Container'));
    if (!hasContainerType) {
      triples.push(
        { subject: `<${resourceIri}>`, predicate: `<${PREFIXES.rdf}type>`, object: `<${PREFIXES.ldp}BasicContainer>` },
        { subject: `<${resourceIri}>`, predicate: `<${PREFIXES.rdf}type>`, object: `<${PREFIXES.ldp}Container>` },
      );
    }
  }

  const nquads = triples.map(t =>
    `${t.subject} ${t.predicate} ${t.object} <${resourceIri}> .`
  ).join('\n');

  // Check if resource already exists — if so, delete old triples first
  const existingIdx = await storage.get(`idx:${resourceIri}`);
  if (existingIdx) {
    try {
      const delSparql = `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <${resourceIri}> { ?s ?p ?o } }`;
      const existing = await orchestrator.query(delSparql, [resourceIri], agent);
      if (existing.type === 'query_results') {
        const existingTriples = sparqlJsonToTriples(JSON.parse(existing.sparql_json));
        if (existingTriples.length > 0) {
          const delNquads = existingTriples.map(t =>
            `${t.subject} ${t.predicate} ${t.object} <${resourceIri}> .`
          ).join('\n');
          await orchestrator.delete(delNquads, agent);
        }
      }
    } catch (e) {
      console.error('Error deleting existing triples:', e);
    }
  }

  // Write triples directly to KV
  if (!agent) return new Response('Forbidden', { status: 403 });

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

  // For new resources, ensure parent containers exist and add containment
  if (!existingIdx) {
    await ensureParentContainers(storage, resourceIri);
  }

  const status = existingIdx ? 204 : 201;
  const headers = solidHeaders(resourceIri, isContainer(resourceIri));
  if (status === 201) headers.set('Location', resourceIri);
  return new Response(null, { status, headers });
}

/**
 * Handle POST — create a new resource inside a container.
 *
 * The Slug header determines the resource name. The Link header with
 * rel="type" BasicContainer creates a sub-container; otherwise the
 * content is stored as a binary blob or parsed as RDF triples.
 * Adds an ldp:contains triple to the parent container.
 */
async function handlePost(reqCtx, resourceIri) {
  const { request, orchestrator, config, url, storage, env } = reqCtx;
  const agent = reqCtx.user ? config.webId : null;

  // Normalize: treat /path as /path/ for POST (container operations)
  if (!isContainer(resourceIri)) {
    resourceIri = resourceIri + '/';
  }
  if (!agent) {
    console.log(`[ldp] POST ${resourceIri} rejected: no authenticated agent`);
    return new Response('Unauthorized', { status: 401 });
  }

  // App write permission check (OIDC apps only)
  if (reqCtx.authMethod === 'oidc' && reqCtx.clientId) {
    const allowed = await checkAppWritePermission(env.APPDATA, config.username, reqCtx.clientId, resourceIri);
    if (!allowed) {
      console.log(`[ldp] POST ${resourceIri} rejected: app ${reqCtx.clientId} not authorized`);
      return new Response('Forbidden — app not authorized for this container', { status: 403 });
    }
  }

  console.log(`[ldp] POST ${resourceIri} by ${agent} slug=${request.headers.get('Slug') || '(none)'}`);

  const slug = request.headers.get('Slug') || crypto.randomUUID();
  const linkHeader = request.headers.get('Link') || '';
  const wantsContainer = linkHeader.includes('BasicContainer');
  const name = slugToName(slug, wantsContainer);
  const newResourceIri = resourceIri + name;

  const contentType = request.headers.get('Content-Type') || 'application/octet-stream';

  if (wantsContainer) {
    // Create container — write directly to KV
    const containerNt = [
      `<${newResourceIri}> <${PREFIXES.rdf}type> <${PREFIXES.ldp}BasicContainer> .`,
      `<${newResourceIri}> <${PREFIXES.rdf}type> <${PREFIXES.ldp}Container> .`,
    ].join('\n');
    await storage.put(`doc:${newResourceIri}:${newResourceIri}`, containerNt);
    await storage.put(`idx:${newResourceIri}`, JSON.stringify({ subjects: [newResourceIri] }));

    // Add containment to parent
    await appendContainment(storage, resourceIri, newResourceIri);

    return new Response(null, {
      status: 201,
      headers: { 'Location': newResourceIri },
    });
  }

  if (isBinaryType(contentType)) {
    const binary = await request.arrayBuffer();

    // Quota checks
    const quotaResult = await checkQuota(env.APPDATA, config.username, binary.byteLength, config.storageLimit);
    if (!quotaResult.allowed) return quotaExceededResponse(quotaResult.usedBytes, quotaResult.limitBytes);
    const cqResult = await checkContainerQuota(env.APPDATA, resourceIri, binary.byteLength);
    if (!cqResult.allowed) return containerQuotaExceededResponse(cqResult.blockedBy, cqResult.usedBytes, cqResult.limitBytes);

    const metadataNquads = buildMetadataNQuads(newResourceIri, contentType, binary.byteLength);
    const aclNt = '';
    try {
      const result = await orchestrator.uploadBinary(newResourceIri, binary, contentType, metadataNquads, aclNt, agent);
      if (result.type === 'auth_error') return new Response('Forbidden', { status: 403 });
    } catch (e) {
      // Fallback: store binary directly
      console.error('uploadBinary error, falling back to direct KV:', e);
      await storage.putBlob(`blob:${newResourceIri}`, binary, contentType);
    }

    // Update quota tracking
    await addQuota(env.APPDATA, config.username, binary.byteLength);
    await addContainerBytes(env.APPDATA, resourceIri, binary.byteLength);

    await appendContainment(storage, resourceIri, newResourceIri);
    return new Response(null, { status: 201, headers: { 'Location': newResourceIri } });
  }

  // RDF content — write directly to KV
  const body = await request.text();
  const triples = parseBody(body, contentType, newResourceIri);
  await writeTriplesToKV(storage, newResourceIri, triples);
  await appendContainment(storage, resourceIri, newResourceIri);

  return new Response(null, { status: 201, headers: { 'Location': newResourceIri } });
}

/**
 * Handle PATCH — apply SPARQL Update to a resource.
 *
 * Supports INSERT DATA, DELETE DATA, and DELETE/INSERT/WHERE patterns.
 * Reads existing triples from KV, applies deletions (set-based matching),
 * appends insertions, and writes the result back.
 */
async function handlePatch(reqCtx, resourceIri) {
  const { request, config, storage, env } = reqCtx;
  if (!reqCtx.user) return new Response('Unauthorized', { status: 401 });

  // App write permission check (OIDC apps only)
  if (reqCtx.authMethod === 'oidc' && reqCtx.clientId) {
    const allowed = await checkAppWritePermission(env.APPDATA, config.username, reqCtx.clientId, resourceIri);
    if (!allowed) {
      console.log(`[ldp] PATCH ${resourceIri} rejected: app ${reqCtx.clientId} not authorized`);
      return new Response('Forbidden — app not authorized for this container', { status: 403 });
    }
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/sparql-update')) {
    return new Response('Unsupported Media Type. Use application/sparql-update', { status: 415 });
  }

  const body = await request.text();
  const { deleteTriples, insertTriples } = parseSparqlUpdate(body, resourceIri);

  // Read existing triples from KV
  const idx = await storage.get(`idx:${resourceIri}`);
  let allTriples = [];
  if (idx) {
    const { subjects } = JSON.parse(idx);
    const docs = await Promise.all(subjects.map(subj => storage.get(`doc:${resourceIri}:${subj}`)));
    for (const nt of docs) {
      if (nt) allTriples.push(...parseNTriples(nt));
    }
  }

  // Apply deletes
  if (deleteTriples.length > 0) {
    const delSet = new Set(deleteTriples.map(t => `${t.subject} ${t.predicate} ${t.object}`));
    allTriples = allTriples.filter(t => !delSet.has(`${t.subject} ${t.predicate} ${t.object}`));
  }

  // Apply inserts
  for (const t of insertTriples) {
    allTriples.push(t);
  }

  // Write back
  await writeTriplesToKV(storage, resourceIri, allTriples);

  // If this created a new resource, ensure parent containers exist and add containment
  if (!idx) {
    await ensureParentContainers(storage, resourceIri);
  }

  return new Response(null, { status: idx ? 204 : 201 });
}

/**
 * Handle DELETE — remove a resource and all its associated data.
 *
 * Deletes: idx entry, all subject documents, blob, metadata, WAC ACL,
 * and ACP policy. Removes the ldp:contains triple from the parent container.
 * Owner-only operation.
 */
async function handleDelete(reqCtx, resourceIri) {
  const { config, storage, env } = reqCtx;
  if (!reqCtx.user) return new Response('Unauthorized', { status: 401 });
  if (reqCtx.user !== config.username) return new Response('Forbidden', { status: 403 });

  // App write permission check (OIDC apps only)
  if (reqCtx.authMethod === 'oidc' && reqCtx.clientId) {
    const allowed = await checkAppWritePermission(env.APPDATA, config.username, reqCtx.clientId, resourceIri);
    if (!allowed) {
      console.log(`[ldp] DELETE ${resourceIri} rejected: app ${reqCtx.clientId} not authorized`);
      return new Response('Forbidden — app not authorized for this container', { status: 403 });
    }
  }

  // Read size from metadata for quota tracking before deletion
  let deletedBytes = 0;
  const metaDoc = await storage.get(`doc:${resourceIri}.meta:${resourceIri}`);
  if (metaDoc) {
    const extentMatch = metaDoc.match(/"(\d+)"\^\^<[^>]*integer>/);
    if (extentMatch) deletedBytes = parseInt(extentMatch[1], 10);
  }

  // Delete all KV entries for this resource
  const idx = await storage.get(`idx:${resourceIri}`);
  if (idx) {
    const parsed = JSON.parse(idx);
    for (const subj of parsed.subjects || []) {
      await storage.delete(`doc:${resourceIri}:${subj}`);
    }
    await storage.delete(`idx:${resourceIri}`);
  }

  // Delete blob, metadata, ACL, ACP
  try { await storage.deleteBlob(`blob:${resourceIri}`); } catch {}
  await storage.delete(`doc:${resourceIri}.meta:${resourceIri}`);
  await storage.delete(`acl:${resourceIri}`);
  await env.APPDATA.delete(`acp:${resourceIri}`);

  // Remove containment from parent
  const parent = parentContainer(resourceIri);
  if (parent) {
    const docKey = `doc:${parent}:${parent}`;
    const parentDoc = await storage.get(docKey);
    if (parentDoc) {
      const triples = parseNTriples(parentDoc);
      const filtered = triples.filter(t =>
        !(t.predicate.includes('contains') && t.object.includes(resourceIri.replace(/[<>]/g, '')))
      );
      const { serializeNTriples: serNT } = await import('../rdf/ntriples.js');
      await storage.put(docKey, serNT(filtered));
    }
  }

  // Update quota tracking on delete
  if (deletedBytes > 0) {
    const { subtractQuota } = await import('../storage/quota.js');
    const { subtractContainerBytes } = await import('../storage/container-quota.js');
    await subtractQuota(env.APPDATA, config.username, deletedBytes);
    if (parent) await subtractContainerBytes(env.APPDATA, parent, deletedBytes);
  }

  return new Response(null, { status: 204 });
}

function handleOptions(reqCtx, resourceIri) {
  const headers = solidHeaders(resourceIri, isContainer(resourceIri));
  return new Response(null, { status: 204, headers });
}

// --- Helpers ---

/**
 * Parse an HTTP request body into an array of triples based on Content-Type.
 * Supports Turtle, N-Triples/N-Quads, JSON-LD, and falls back to Turtle.
 * @param {string} body - Raw request body text
 * @param {string} contentType - MIME type of the body
 * @param {string} baseIri - Base IRI for resolving relative references
 * @returns {Array<{subject: string, predicate: string, object: string}>}
 */
function parseBody(body, contentType, baseIri) {
  if (contentType.includes('text/turtle')) {
    return parseTurtle(body, baseIri);
  }
  if (contentType.includes('application/n-triples') || contentType.includes('application/n-quads')) {
    return parseNTriples(body);
  }
  if (contentType.includes('application/ld+json')) {
    // Basic JSON-LD to triples: handle flat objects
    return jsonLdToTriples(JSON.parse(body));
  }
  return parseTurtle(body, baseIri);
}

/**
 * Build a 401/403 deny response for ACP access failures.
 */
function denyAccess(agent, baseUrl) {
  const status = agent ? 403 : 401;
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  if (!agent) headers.set('WWW-Authenticate', `Bearer realm="${baseUrl}", scope="openid webid"`);
  return new Response(JSON.stringify({
    error: agent ? 'forbidden' : 'unauthorized',
    message: agent ? 'You do not have access to this resource.' : 'Authentication required.',
  }), { status, headers });
}

/**
 * Convert a flat JSON-LD document to triples.
 * Handles @id (subject), @type (rdf:type), and simple key-value properties.
 * Object values can be IRIs ({@id}), typed literals ({@value, @type}),
 * language-tagged literals ({@value, @language}), or plain strings.
 */
function jsonLdToTriples(doc) {
  const triples = [];
  const items = Array.isArray(doc) ? doc : [doc];
  for (const item of items) {
    const subject = item['@id'] ? `<${item['@id']}>` : `_:b${Math.random().toString(36).slice(2)}`;
    if (item['@type']) {
      const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
      for (const t of types) {
        triples.push({ subject, predicate: `<${PREFIXES.rdf}type>`, object: `<${t}>` });
      }
    }
    for (const [key, value] of Object.entries(item)) {
      if (key.startsWith('@')) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        if (typeof v === 'object' && v['@id']) {
          triples.push({ subject, predicate: `<${key}>`, object: `<${v['@id']}>` });
        } else if (typeof v === 'object' && v['@value'] !== undefined) {
          let obj = `"${v['@value']}"`;
          if (v['@language']) obj += `@${v['@language']}`;
          if (v['@type']) obj += `^^<${v['@type']}>`;
          triples.push({ subject, predicate: `<${key}>`, object: obj });
        } else if (typeof v === 'string') {
          triples.push({ subject, predicate: `<${key}>`, object: `"${v}"` });
        }
      }
    }
  }
  return triples;
}

function sparqlJsonToTriples(sparqlJson) {
  // SPARQL JSON results format → triples
  const triples = [];
  if (!sparqlJson.results || !sparqlJson.results.bindings) return triples;
  for (const binding of sparqlJson.results.bindings) {
    const s = termToNT(binding.s || binding.subject);
    const p = termToNT(binding.p || binding.predicate);
    const o = termToNT(binding.o || binding.object);
    if (s && p && o) triples.push({ subject: s, predicate: p, object: o });
  }
  return triples;
}

function termToNT(term) {
  if (!term) return null;
  if (term.type === 'uri') return `<${term.value}>`;
  if (term.type === 'bnode') return `_:${term.value}`;
  if (term.type === 'literal' || term.type === 'typed-literal') {
    let nt = `"${term.value}"`;
    if (term['xml:lang']) nt += `@${term['xml:lang']}`;
    else if (term.datatype) nt += `^^<${term.datatype}>`;
    return nt;
  }
  return null;
}

/**
 * Parse a SPARQL Update request body into delete and insert triple sets.
 *
 * Supports three patterns:
 *   - `INSERT DATA { ... }` — triples to add
 *   - `DELETE DATA { ... }` — triples to remove
 *   - `DELETE { ... } INSERT { ... } WHERE { ... }` — combined update
 *
 * PREFIX declarations are extracted and prepended to each block before
 * parsing as Turtle. The WHERE clause is ignored (we do set-based matching).
 *
 * @param {string} body - SPARQL Update text
 * @param {string} baseIri - Base IRI for the target resource
 * @returns {{ deleteTriples: Array, insertTriples: Array }}
 */
export function parseSparqlUpdate(body, baseIri) {
  const deleteTriples = [];
  const insertTriples = [];

  // Extract PREFIX declarations (they apply to the whole update)
  const prefixLines = [];
  for (const match of body.matchAll(/PREFIX\s+(\S+)\s+<([^>]+)>/gi)) {
    prefixLines.push(`@prefix ${match[1]} <${match[2]}> .`);
  }
  const prefixBlock = prefixLines.join('\n');

  // Extract brace-delimited blocks, handling balanced braces
  function extractBlock(str, startIdx) {
    let depth = 0;
    let start = -1;
    for (let i = startIdx; i < str.length; i++) {
      if (str[i] === '{') { if (depth === 0) start = i + 1; depth++; }
      else if (str[i] === '}') { depth--; if (depth === 0) return str.slice(start, i); }
    }
    return '';
  }

  // INSERT DATA { ... }
  const insIdx = body.search(/INSERT\s+DATA\s*\{/i);
  if (insIdx >= 0) {
    const blockStart = body.indexOf('{', insIdx);
    const block = extractBlock(body, blockStart);
    insertTriples.push(...parseTurtle(prefixBlock + '\n' + block, baseIri));
  }

  // DELETE DATA { ... }
  const delIdx = body.search(/DELETE\s+DATA\s*\{/i);
  if (delIdx >= 0) {
    const blockStart = body.indexOf('{', delIdx);
    const block = extractBlock(body, blockStart);
    deleteTriples.push(...parseTurtle(prefixBlock + '\n' + block, baseIri));
  }

  // DELETE { ... } INSERT { ... } WHERE { ... }
  const diIdx = body.search(/DELETE\s*\{/i);
  if (diIdx >= 0 && insIdx < 0 && delIdx < 0) {
    const delBlockStart = body.indexOf('{', diIdx);
    const delBlock = extractBlock(body, delBlockStart);
    deleteTriples.push(...parseTurtle(prefixBlock + '\n' + delBlock, baseIri));

    const afterDel = delBlockStart + delBlock.length + 2;
    const insPartIdx = body.indexOf('{', afterDel);
    if (insPartIdx >= 0) {
      const insBlock = extractBlock(body, insPartIdx);
      insertTriples.push(...parseTurtle(prefixBlock + '\n' + insBlock, baseIri));
    }
  }

  return { deleteTriples, insertTriples };
}

function buildMetadataNQuads(resourceIri, contentType, byteLength) {
  const metaGraph = `${resourceIri}.meta`;
  return [
    `<${resourceIri}> <${PREFIXES.rdf}type> <${PREFIXES.schema}DigitalDocument> <${metaGraph}> .`,
    `<${resourceIri}> <${PREFIXES.dcterms}format> "${contentType}" <${metaGraph}> .`,
    `<${resourceIri}> <${PREFIXES.dcterms}extent> "${byteLength}"^^<${PREFIXES.xsd}integer> <${metaGraph}> .`,
  ].join('\n');
}

/**
 * Write triples for a resource directly to KV, grouped by subject.
 */
export async function writeTriplesToKV(storage, resourceIri, triples) {
  const bySubject = new Map();
  for (const t of triples) {
    const s = t.subject.startsWith('<') && t.subject.endsWith('>') ? t.subject.slice(1, -1) : t.subject;
    if (!bySubject.has(s)) bySubject.set(s, []);
    bySubject.get(s).push(t);
  }

  for (const [subjectIri, subjectTriples] of bySubject) {
    const nt = subjectTriples.map(t => `${t.subject} ${t.predicate} ${t.object} .`).join('\n');
    await storage.put(`doc:${resourceIri}:${subjectIri}`, nt);
  }

  await storage.put(`idx:${resourceIri}`, JSON.stringify({ subjects: [...bySubject.keys()] }));
}

/**
 * Predicate-to-template-variable mapping for profile rendering.
 */
const PROFILE_PREDICATE_MAP = {
  [`${PREFIXES.foaf}name`]: 'name',
  [`${PREFIXES.foaf}nick`]: 'nick',
  [`${PREFIXES.foaf}img`]: 'img',
  [`${PREFIXES.foaf}mbox`]: 'email',
  [`${PREFIXES.foaf}homepage`]: 'homepage',
  [`${PREFIXES.vcard}note`]: 'bio',
  [`${PREFIXES.vcard}role`]: 'role',
  [`${PREFIXES.schema}description`]: 'description',
};

/**
 * Shorten a full predicate IRI to a prefixed form (e.g. foaf:name).
 */
function shortenPredicate(predicateIri) {
  for (const [prefix, ns] of Object.entries(PREFIXES)) {
    if (predicateIri.startsWith(ns)) {
      return `${prefix}:${predicateIri.slice(ns.length)}`;
    }
  }
  return predicateIri;
}

/**
 * Read all profile triples from KV for the WebID subject.
 * Returns the raw triple array from idx + doc keys of the profile document.
 */
export async function readProfileTriples(storage, config) {
  const profileIri = `${config.baseUrl}/${config.username}/profile/card`;
  const webId = config.webId;
  const allTriples = [];

  const idx = await storage.get(`idx:${profileIri}`);
  if (idx) {
    const { subjects } = JSON.parse(idx);
    for (const subj of subjects) {
      const nt = await storage.get(`doc:${profileIri}:${subj}`);
      if (nt) allTriples.push(...parseNTriples(nt));
    }
  }

  return allTriples;
}

/**
 * Build Mustache template data from profile triples.
 */
async function buildProfileTemplateData(storage, config) {
  const allTriples = await readProfileTriples(storage, config);
  const webId = config.webId;

  const data = {
    username: config.username,
    webId,
    domain: config.domain,
    baseUrl: config.baseUrl,
    triples: [],
  };

  // Collect custom (non-mapped) predicates grouped by key
  const customBuckets = new Map();

  // Only map triples whose subject is the WebID
  for (const t of allTriples) {
    const subjectIri = unwrapIri(t.subject);
    if (subjectIri !== webId) continue;

    const predicateIri = unwrapIri(t.predicate);
    const varName = PROFILE_PREDICATE_MAP[predicateIri];

    // Determine the object value
    let objectValue;
    if (t.object.startsWith('<')) {
      objectValue = unwrapIri(t.object);
    } else {
      objectValue = unwrapLiteral(t.object);
    }

    if (varName) {
      let val = objectValue;
      // Strip mailto: for email
      if (varName === 'email' && val.startsWith('mailto:')) {
        val = val.slice(7);
      }
      data[varName] = val;
    } else {
      // Group custom triples by predicate key
      const key = predicateToKey(predicateIri);
      if (!customBuckets.has(key)) {
        customBuckets.set(key, {
          predicate: predicateIri,
          predicateShort: shortenPredicate(predicateIri),
          key,
          values: [],
        });
      }
      const isLink = objectValue.startsWith('http://') || objectValue.startsWith('https://');
      const short = shortenPredicate(predicateIri);
      customBuckets.get(key).values.push({ value: objectValue, isLink, predicate: predicateIri, predicateShort: short });
    }

    // Always add to the raw triples array
    data.triples.push({
      predicate: predicateIri,
      predicateShort: shortenPredicate(predicateIri),
      object: objectValue,
    });
  }

  // Expose each custom group in two forms:
  //   data[key]          = plain string (first value) for scalar use: {{key}}
  //   data[key + '_list'] = array of {value, isLink} for iteration: {{#key_list}}
  //   data['has_' + key] = boolean flag for conditionals: {{#has_key}}
  const customGroups = [];
  for (const group of customBuckets.values()) {
    data[group.key] = group.values[0].value;
    data[group.key + '_list'] = group.values;
    data['has_' + group.key] = true;
    customGroups.push(group);
  }
  data.customGroups = customGroups;
  data.hasCustomGroups = customGroups.length > 0;

  return data;
}

/**
 * Convert a predicate IRI to a Mustache-safe variable name.
 * e.g. "http://xmlns.com/foaf/0.1/knows" → "foaf_knows"
 */
function predicateToKey(predicateIri) {
  for (const [prefix, ns] of Object.entries(PREFIXES)) {
    if (predicateIri.startsWith(ns)) {
      return prefix + '_' + predicateIri.slice(ns.length);
    }
  }
  // Fallback: use last path or fragment segment
  const pos = Math.max(predicateIri.lastIndexOf('#'), predicateIri.lastIndexOf('/'));
  return pos >= 0 ? predicateIri.slice(pos + 1) : predicateIri;
}

/**
 * Ensure all parent containers exist up to the storage root.
 * Creates missing intermediate containers and adds containment triples.
 */
async function ensureParentContainers(storage, resourceIri) {
  let childIri = resourceIri;
  let parent = parentContainer(childIri);

  while (parent) {
    // Add containment triple
    await appendContainment(storage, parent, childIri);

    // If parent container doesn't have an idx entry, create it as a container
    const parentIdx = await storage.get(`idx:${parent}`);
    if (!parentIdx) {
      const containerNt = [
        `<${parent}> <${PREFIXES.rdf}type> <${PREFIXES.ldp}BasicContainer> .`,
        `<${parent}> <${PREFIXES.rdf}type> <${PREFIXES.ldp}Container> .`,
      ].join('\n');
      const existingDoc = await storage.get(`doc:${parent}:${parent}`);
      if (existingDoc) {
        // Doc exists (containment was just added) but no idx — add container types
        if (!existingDoc.includes('BasicContainer')) {
          await storage.put(`doc:${parent}:${parent}`, existingDoc + '\n' + containerNt);
        }
      } else {
        await storage.put(`doc:${parent}:${parent}`, containerNt);
      }
      await storage.put(`idx:${parent}`, JSON.stringify({ subjects: [parent] }));

      // Continue up the chain
      childIri = parent;
      parent = parentContainer(parent);
    } else {
      // Parent exists — just needed containment (already added above)
      break;
    }
  }
}

/**
 * Append a containment triple to a parent container in KV.
 */
async function appendContainment(storage, parentIri, childIri) {
  const containNt = `<${parentIri}> <${PREFIXES.ldp}contains> <${childIri}> .`;
  const docKey = `doc:${parentIri}:${parentIri}`;
  const existing = await storage.get(docKey);
  if (existing) {
    // Avoid duplicates
    if (!existing.includes(`<${childIri}>`)) {
      await storage.put(docKey, existing + '\n' + containNt);
    }
  } else {
    await storage.put(docKey, containNt);
  }
}
