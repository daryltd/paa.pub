/**
 * LDP protocol handler.
 *
 * Maps HTTP methods to s20e Orchestrator calls for RDF resources,
 * and handles binary resources via uploadBinary/serveBinary.
 */
import { negotiateType, serializeRdf, wantsActivityPub } from './conneg.js';
import { solidHeaders, buildWacAllow } from './headers.js';
import { parseTurtle } from '../rdf/turtle-parser.js';
import { parseNTriples, serializeNQuads, iri } from '../rdf/ntriples.js';
import { isContainer, slugToName, addContainment, containerTypeQuads, parentContainer } from './containers.js';
import { handleAclGet, handleAclPut, handleAclDelete, defaultAclNTriples } from './acl.js';
import { checkAcpAccess } from '../ui/pages/acl-editor.js';
import { PREFIXES } from '../rdf/prefixes.js';

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
      if (reqCtx.user !== config.username) {
        const agent = reqCtx.user ? config.webId : null;
        const access = await checkAcpAccess(reqCtx.env.APPDATA, indexIri, agent, config.webId, config.username);
        if (!access.readable) {
          const status = agent ? 403 : 401;
          const headers = new Headers({ 'Content-Type': 'application/json' });
          if (!agent) headers.set('WWW-Authenticate', `Bearer realm="${config.baseUrl}", scope="openid webid"`);
          return new Response(JSON.stringify({ error: agent ? 'forbidden' : 'unauthorized', message: 'Authentication required.' }), { status, headers });
        }
      }
      // Serve the raw HTML blob — set Content-Type explicitly and return
      // without going through handleGet which would serve Turtle
      const htmlHeaders = new Headers();
      htmlHeaders.set('Content-Type', 'text/html; charset=utf-8');
      htmlHeaders.set('Cache-Control', 'no-cache');
      htmlHeaders.set('X-Content-Type-Options', 'nosniff');
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: htmlHeaders });
      return new Response(new Uint8Array(indexBlob), { status: 200, headers: htmlHeaders });
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

async function handleGet(reqCtx, resourceIri) {
  const { request, config, storage, env } = reqCtx;
  const agent = reqCtx.user ? config.webId : null;

  // Check if the resource exists in KV
  const idx = await storage.get(`idx:${resourceIri}`);
  if (!idx) {
    // Also check for blobs without an idx entry
    const blob = await storage.getBlob(`blob:${resourceIri}`);
    if (!blob) return new Response('Not Found', { status: 404 });

    // Serve orphan blob — check ACP first
    if (reqCtx.user !== config.username) {
      const access = await checkAcpAccess(env.APPDATA, resourceIri, agent, config.webId, config.username);
      if (!access.readable) {
        const status = agent ? 403 : 401;
        const headers = new Headers({ 'Content-Type': 'application/json' });
        if (!agent) headers.set('WWW-Authenticate', `Bearer realm="${config.baseUrl}", scope="openid webid"`);
        return new Response(JSON.stringify({
          error: agent ? 'forbidden' : 'unauthorized',
          message: agent ? 'You do not have access to this resource.' : 'Authentication required.',
          resource: resourceIri,
        }), { status, headers });
      }
    }
    const headers = solidHeaders(resourceIri, false);
    headers.set('Content-Type', 'application/octet-stream');
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(blob, { status: 200, headers });
  }

  // Check ACP access for non-owner requests
  if (reqCtx.user !== config.username) {
    const access = await checkAcpAccess(env.APPDATA, resourceIri, agent, config.webId, config.username);
    if (!access.readable) {
      const status = agent ? 403 : 401;
      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      if (!agent) headers.set('WWW-Authenticate', `Bearer realm="${config.baseUrl}", scope="openid webid"`);
      return new Response(JSON.stringify({
        error: agent ? 'forbidden' : 'unauthorized',
        message: agent ? 'You do not have access to this resource.' : 'Authentication required to access this resource.',
        resource: resourceIri,
      }), { status, headers });
    }
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
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(blob, { status: 200, headers });
  }

  // Read RDF triples
  const allTriples = [];
  for (const subj of parsed.subjects || []) {
    const nt = await storage.get(`doc:${resourceIri}:${subj}`);
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

  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(body, { status: 200, headers });
}

async function handlePut(reqCtx, resourceIri) {
  const { request, orchestrator, config, storage } = reqCtx;
  const agent = reqCtx.user ? config.webId : null;
  const contentType = request.headers.get('Content-Type') || 'application/octet-stream';

  if (!agent) {
    console.log(`[ldp] PUT ${resourceIri} rejected: no authenticated agent`);
    return new Response('Unauthorized', { status: 401 });
  }
  console.log(`[ldp] PUT ${resourceIri} by ${agent} ct=${contentType}`);

  if (isBinaryType(contentType)) {
    const binary = await request.arrayBuffer();
    const metadataNquads = buildMetadataNQuads(resourceIri, contentType, binary.byteLength);
    const aclNt = defaultAclNTriples(resourceIri, config.webId);
    const result = await orchestrator.uploadBinary(resourceIri, binary, contentType, metadataNquads, aclNt, agent);
    if (result.type === 'auth_error') return new Response('Forbidden', { status: 403 });
    if (result.type === 'validation_error') return new Response(result.report_json, { status: 422 });
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

  // For new resources, add containment to parent
  if (!existingIdx) {
    const parent = parentContainer(resourceIri);
    if (parent) {
      const { appendContainment } = await import('../ui/pages/storage.js');
      // Not available — inline it
      const containNt = `<${parent}> <${PREFIXES.ldp}contains> <${resourceIri}> .`;
      const parentDoc = await storage.get(`doc:${parent}:${parent}`);
      if (parentDoc) {
        if (!parentDoc.includes(`<${resourceIri}>`)) {
          await storage.put(`doc:${parent}:${parent}`, parentDoc + '\n' + containNt);
        }
      } else {
        await storage.put(`doc:${parent}:${parent}`, containNt);
      }
    }
  }

  const status = existingIdx ? 204 : 201;
  const headers = solidHeaders(resourceIri, isContainer(resourceIri));
  if (status === 201) headers.set('Location', resourceIri);
  return new Response(null, { status, headers });
}

async function handlePost(reqCtx, resourceIri) {
  const { request, orchestrator, config, url, storage } = reqCtx;
  const agent = reqCtx.user ? config.webId : null;

  // Normalize: treat /path as /path/ for POST (container operations)
  if (!isContainer(resourceIri)) {
    resourceIri = resourceIri + '/';
  }
  if (!agent) {
    console.log(`[ldp] POST ${resourceIri} rejected: no authenticated agent`);
    return new Response('Unauthorized', { status: 401 });
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

async function handlePatch(reqCtx, resourceIri) {
  const { request, config, storage } = reqCtx;
  if (!reqCtx.user) return new Response('Unauthorized', { status: 401 });

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
    for (const subj of subjects) {
      const nt = await storage.get(`doc:${resourceIri}:${subj}`);
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
  return new Response(null, { status: 204 });
}

async function handleDelete(reqCtx, resourceIri) {
  const { config, storage, env } = reqCtx;
  if (!reqCtx.user) return new Response('Unauthorized', { status: 401 });
  if (reqCtx.user !== config.username) return new Response('Forbidden', { status: 403 });

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

  return new Response(null, { status: 204 });
}

function handleOptions(reqCtx, resourceIri) {
  const headers = solidHeaders(resourceIri, isContainer(resourceIri));
  return new Response(null, { status: 204, headers });
}

// --- Helpers ---

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

function parseSparqlUpdate(body, baseIri) {
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
async function writeTriplesToKV(storage, resourceIri, triples) {
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
