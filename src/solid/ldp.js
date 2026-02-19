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

  // Handle .acl resources
  if (url.pathname.endsWith('.acl')) {
    const baseIri = resourceIri.slice(0, -4);
    switch (request.method) {
      case 'GET': case 'HEAD': return handleAclGet(reqCtx, baseIri);
      case 'PUT': return handleAclPut(reqCtx, baseIri);
      case 'DELETE': return handleAclDelete(reqCtx, baseIri);
      default: return new Response('Method Not Allowed', { status: 405 });
    }
  }

  // Content negotiation for HTML — serve stored HTML if available
  const accept = request.headers.get('Accept') || '';
  if (request.method === 'GET' && isContainer(resourceIri) && accept.includes('text/html') && !wantsActivityPub(accept)) {
    // Try serving index.html from the container
    const indexIri = resourceIri + 'index.html';
    const result = await reqCtx.orchestrator.serveBinary(indexIri, reqCtx.user ? config.webId : null);
    if (result.granted && result.data) {
      return new Response(result.data, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    // Fall through to container listing
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
  const { request, orchestrator, config } = reqCtx;
  const agent = reqCtx.user ? config.webId : null;

  // Try binary first
  const binaryResult = await orchestrator.serveBinary(resourceIri, agent);
  if (binaryResult.granted && binaryResult.data) {
    const headers = solidHeaders(resourceIri, false);
    headers.set('Content-Type', binaryResult.contentType || 'application/octet-stream');
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(binaryResult.data, { status: 200, headers });
  }

  // Try RDF query
  const sparql = `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <${resourceIri}> { ?s ?p ?o } }`;
  const result = await orchestrator.query(sparql, [resourceIri], agent);

  if (result.type === 'auth_error') {
    return new Response('Forbidden', { status: 403 });
  }
  if (result.type === 'error') {
    // Check if resource exists — empty result means not found
    return new Response('Not Found', { status: 404 });
  }
  if (result.type === 'query_results') {
    const parsed = JSON.parse(result.sparql_json);
    // SPARQL CONSTRUCT returns results in a specific format
    const triples = sparqlJsonToTriples(parsed);
    if (triples.length === 0) {
      return new Response('Not Found', { status: 404 });
    }

    const accept = request.headers.get('Accept') || 'text/turtle';
    const contentType = negotiateType(accept);
    const body = serializeRdf(triples, contentType);

    const headers = solidHeaders(resourceIri, isContainer(resourceIri));
    headers.set('Content-Type', contentType);
    if (isContainer(resourceIri)) {
      const wacAllow = reqCtx.user === config.username
        ? buildWacAllow({ user: ['read', 'write', 'append', 'control'], public: ['read'] })
        : buildWacAllow({ user: [], public: ['read'] });
      headers.set('WAC-Allow', wacAllow);
    }

    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(body, { status: 200, headers });
  }

  return new Response('Not Found', { status: 404 });
}

async function handlePut(reqCtx, resourceIri) {
  const { request, orchestrator, config } = reqCtx;
  const agent = reqCtx.user ? config.webId : null;
  const contentType = request.headers.get('Content-Type') || 'application/octet-stream';

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
  const nquads = triples.map(t =>
    `${t.subject} ${t.predicate} ${t.object} <${resourceIri}> .`
  ).join('\n');

  // Delete existing, then insert new
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

  const result = await orchestrator.insert(nquads, agent);
  if (result.type === 'auth_error') return new Response('Forbidden', { status: 403 });
  if (result.type === 'validation_error') return new Response(result.report_json, { status: 422 });

  return new Response(null, { status: 201, headers: { 'Location': resourceIri } });
}

async function handlePost(reqCtx, resourceIri) {
  const { request, orchestrator, config, url } = reqCtx;
  const agent = reqCtx.user ? config.webId : null;

  if (!isContainer(resourceIri)) {
    return new Response('POST is only supported on containers', { status: 405 });
  }

  const slug = request.headers.get('Slug') || crypto.randomUUID();
  const linkHeader = request.headers.get('Link') || '';
  const wantsContainer = linkHeader.includes('BasicContainer');
  const name = slugToName(slug, wantsContainer);
  const newResourceIri = resourceIri + name;

  const contentType = request.headers.get('Content-Type') || 'application/octet-stream';

  if (wantsContainer) {
    // Create container
    const typeQuads = containerTypeQuads(newResourceIri);
    const containment = addContainment(resourceIri, newResourceIri);
    const nquads = typeQuads + '\n' + containment;
    const result = await orchestrator.insert(nquads, agent);
    if (result.type === 'auth_error') return new Response('Forbidden', { status: 403 });
    return new Response(null, {
      status: 201,
      headers: { 'Location': newResourceIri },
    });
  }

  if (isBinaryType(contentType)) {
    const binary = await request.arrayBuffer();
    const metadataNquads = buildMetadataNQuads(newResourceIri, contentType, binary.byteLength);
    const aclNt = defaultAclNTriples(newResourceIri, config.webId);
    const result = await orchestrator.uploadBinary(newResourceIri, binary, contentType, metadataNquads, aclNt, agent);
    if (result.type === 'auth_error') return new Response('Forbidden', { status: 403 });

    // Add containment triple
    const containment = addContainment(resourceIri, newResourceIri);
    await orchestrator.insert(containment, agent);

    return new Response(null, { status: 201, headers: { 'Location': newResourceIri } });
  }

  // RDF content
  const body = await request.text();
  const triples = parseBody(body, contentType, newResourceIri);
  const nquads = triples.map(t =>
    `${t.subject} ${t.predicate} ${t.object} <${newResourceIri}> .`
  ).join('\n');

  const containment = addContainment(resourceIri, newResourceIri);
  const allNquads = nquads + '\n' + containment;

  const result = await orchestrator.insert(allNquads, agent);
  if (result.type === 'auth_error') return new Response('Forbidden', { status: 403 });
  if (result.type === 'validation_error') return new Response(result.report_json, { status: 422 });

  return new Response(null, { status: 201, headers: { 'Location': newResourceIri } });
}

async function handlePatch(reqCtx, resourceIri) {
  const { request, orchestrator, config } = reqCtx;
  const agent = reqCtx.user ? config.webId : null;
  const contentType = request.headers.get('Content-Type') || '';

  if (!contentType.includes('application/sparql-update')) {
    return new Response('Unsupported Media Type. Use application/sparql-update', { status: 415 });
  }

  const body = await request.text();

  // Parse SPARQL Update: extract DELETE and INSERT clauses
  const { deleteTriples, insertTriples } = parseSparqlUpdate(body, resourceIri);

  if (deleteTriples.length > 0) {
    const delNquads = deleteTriples.map(t =>
      `${t.subject} ${t.predicate} ${t.object} <${resourceIri}> .`
    ).join('\n');
    const result = await orchestrator.delete(delNquads, agent);
    if (result.type === 'auth_error') return new Response('Forbidden', { status: 403 });
  }

  if (insertTriples.length > 0) {
    const insNquads = insertTriples.map(t =>
      `${t.subject} ${t.predicate} ${t.object} <${resourceIri}> .`
    ).join('\n');
    const result = await orchestrator.insert(insNquads, agent);
    if (result.type === 'auth_error') return new Response('Forbidden', { status: 403 });
  }

  return new Response(null, { status: 204 });
}

async function handleDelete(reqCtx, resourceIri) {
  const { orchestrator, config } = reqCtx;
  const agent = reqCtx.user ? config.webId : null;

  // Delete all triples in the resource graph
  const sparql = `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <${resourceIri}> { ?s ?p ?o } }`;
  const existing = await orchestrator.query(sparql, [resourceIri], agent);

  if (existing.type === 'auth_error') return new Response('Forbidden', { status: 403 });

  if (existing.type === 'query_results') {
    const triples = sparqlJsonToTriples(JSON.parse(existing.sparql_json));
    if (triples.length > 0) {
      const nquads = triples.map(t =>
        `${t.subject} ${t.predicate} ${t.object} <${resourceIri}> .`
      ).join('\n');
      await orchestrator.delete(nquads, agent);
    }
  }

  // Remove containment from parent
  const parent = parentContainer(resourceIri);
  if (parent) {
    const containment = `${iri(parent)} ${iri(PREFIXES.ldp + 'contains')} ${iri(resourceIri)} ${iri(parent)} .`;
    await orchestrator.delete(containment, agent);
  }

  // Delete ACL
  await reqCtx.storage.delete(`acl:${resourceIri}`);

  // Delete binary blob if exists
  try { await reqCtx.storage.deleteBlob(`blob:${resourceIri}`); } catch {}

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

  // Simple SPARQL Update parser for DELETE DATA { } INSERT DATA { } patterns
  const deleteMatch = body.match(/DELETE\s+DATA\s*\{([^}]*)\}/is);
  const insertMatch = body.match(/INSERT\s+DATA\s*\{([^}]*)\}/is);

  // Also handle DELETE { } INSERT { } WHERE { } pattern
  const diMatch = body.match(/DELETE\s*\{([^}]*)\}\s*INSERT\s*\{([^}]*)\}\s*WHERE/is);

  if (deleteMatch) {
    deleteTriples.push(...parseTurtle(deleteMatch[1], baseIri));
  }
  if (insertMatch) {
    insertTriples.push(...parseTurtle(insertMatch[1], baseIri));
  }
  if (diMatch) {
    deleteTriples.push(...parseTurtle(diMatch[1], baseIri));
    insertTriples.push(...parseTurtle(diMatch[2], baseIri));
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
