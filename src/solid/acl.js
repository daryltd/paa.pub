/**
 * ACL/ACR resource management for Solid WAC and ACP.
 */
import { PREFIXES } from '../rdf/prefixes.js';
import { iri } from '../rdf/ntriples.js';
import { parseTurtle } from '../rdf/turtle-parser.js';
import { serializeTurtle } from '../rdf/turtle-serializer.js';
import { parseNTriples, serializeNTriples } from '../rdf/ntriples.js';
import { solidHeaders } from './headers.js';
import { parseSparqlUpdate } from './ldp.js';
import { loadPolicy, loadFriends, policyToTurtle } from '../ui/pages/acl-editor.js';
import { getUserConfig } from '../config.js';

/** Extract the resource owner's username from a resource IRI. */
function extractOwner(resourceIri, baseUrl) {
  const path = resourceIri.slice(baseUrl.length + 1);
  const slash = path.indexOf('/');
  return slash > 0 ? path.slice(0, slash) : path;
}

/**
 * Handle GET/HEAD for .acl resources.
 * WAC spec: Servers MUST accept GET and HEAD targeting an ACL resource
 * when Accept requests text/turtle. Return 404 only when no ACL exists.
 * @param {object} reqCtx
 * @param {string} resourceIri - the subject resource IRI (without .acl)
 * @returns {Promise<Response>}
 */
export async function handleAclGet(reqCtx, resourceIri) {
  const { request, storage, config } = reqCtx;

  // ACL access requires acl:Control — for now, only the resource owner
  if (reqCtx.user !== extractOwner(resourceIri, config.baseUrl)) {
    return new Response('Forbidden', { status: 403 });
  }

  const aclData = await storage.get(`acl:${resourceIri}`);
  if (!aclData) {
    return new Response('Not Found', { status: 404 });
  }

  // Parse stored N-Triples and serialize as Turtle for the response
  const triples = parseNTriples(aclData);
  const aclIri = resourceIri + '.acl';
  const turtle = serializeTurtle(triples, aclIri);

  const headers = solidHeaders(resourceIri, false);
  headers.set('Content-Type', 'text/turtle');

  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }
  return new Response(turtle, { status: 200, headers });
}

/**
 * Handle PUT for .acl resources.
 * @param {object} reqCtx
 * @param {string} resourceIri
 * @returns {Promise<Response>}
 */
export async function handleAclPut(reqCtx, resourceIri) {
  const { request, storage, config } = reqCtx;

  if (reqCtx.user !== extractOwner(resourceIri, config.baseUrl)) {
    return new Response('Forbidden', { status: 403 });
  }

  const contentType = request.headers.get('Content-Type') || 'text/turtle';
  const body = await request.text();

  let triples;
  if (contentType.includes('text/turtle')) {
    triples = parseTurtle(body, resourceIri + '.acl');
  } else {
    triples = parseNTriples(body);
  }

  const existing = await storage.get(`acl:${resourceIri}`);
  const ntriples = serializeNTriples(triples);
  await storage.put(`acl:${resourceIri}`, ntriples);

  return new Response(null, { status: existing ? 204 : 201 });
}

/**
 * Handle PATCH for .acl resources (SPARQL Update).
 * @param {object} reqCtx
 * @param {string} resourceIri
 * @returns {Promise<Response>}
 */
export async function handleAclPatch(reqCtx, resourceIri) {
  const { request, storage, config } = reqCtx;

  if (reqCtx.user !== extractOwner(resourceIri, config.baseUrl)) {
    return new Response('Forbidden', { status: 403 });
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/sparql-update')) {
    return new Response('Unsupported Media Type. Use application/sparql-update', { status: 415 });
  }

  const aclIri = resourceIri + '.acl';
  const body = await request.text();

  // Parse SPARQL Update
  const { deleteTriples, insertTriples } = parseSparqlUpdate(body, aclIri);

  // Read existing ACL triples
  const aclData = await storage.get(`acl:${resourceIri}`);
  let allTriples = aclData ? parseNTriples(aclData) : [];

  // Apply deletes
  if (deleteTriples.length > 0) {
    const delSet = new Set(deleteTriples.map(t => `${t.subject} ${t.predicate} ${t.object}`));
    allTriples = allTriples.filter(t => !delSet.has(`${t.subject} ${t.predicate} ${t.object}`));
  }

  // Apply inserts
  for (const t of insertTriples) {
    allTriples.push(t);
  }

  await storage.put(`acl:${resourceIri}`, serializeNTriples(allTriples));
  return new Response(null, { status: aclData ? 204 : 201 });
}

/**
 * Handle DELETE for .acl resources.
 * @param {object} reqCtx
 * @param {string} resourceIri
 * @returns {Promise<Response>}
 */
export async function handleAclDelete(reqCtx, resourceIri) {
  if (reqCtx.user !== extractOwner(resourceIri, reqCtx.config.baseUrl)) {
    return new Response('Forbidden', { status: 403 });
  }
  await reqCtx.storage.delete(`acl:${resourceIri}`);
  return new Response(null, { status: 204 });
}

/**
 * Reset an ACL to the default owner-only policy.
 * Useful for the storage root container where DELETE is not allowed,
 * or any resource where the user wants to restore default access.
 * @param {object} reqCtx
 * @param {string} resourceIri
 * @returns {Promise<Response>}
 */
export async function handleAclReset(reqCtx, resourceIri) {
  const { storage, config } = reqCtx;
  const owner = extractOwner(resourceIri, config.baseUrl);

  if (reqCtx.user !== owner) {
    return new Response('Forbidden', { status: 403 });
  }

  const ownerUc = getUserConfig(config, owner);
  const ntriples = defaultAclNTriples(resourceIri, ownerUc.webId);
  await storage.put(`acl:${resourceIri}`, ntriples);
  return new Response(null, { status: 205 });
}

/**
 * Handle GET/HEAD for .acr resources (ACP Access Control Resources).
 * Generates Turtle from the stored ACP policy JSON.
 * @param {object} reqCtx
 * @param {string} resourceIri - the subject resource IRI (without .acr)
 * @returns {Promise<Response>}
 */
export async function handleAcrGet(reqCtx, resourceIri) {
  const { request, config, env } = reqCtx;

  if (reqCtx.user !== extractOwner(resourceIri, config.baseUrl)) {
    return new Response('Forbidden', { status: 403 });
  }

  const owner = extractOwnerFromIri(resourceIri, config.baseUrl);
  const ownerUc = getUserConfig(config, owner);
  const policy = await loadPolicy(env.APPDATA, resourceIri);
  const friends = await loadFriends(env.APPDATA, owner);
  const turtle = policyToTurtle(policy, resourceIri, ownerUc.webId, friends);

  const headers = solidHeaders(resourceIri, false);
  headers.set('Content-Type', 'text/turtle');

  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }
  return new Response(turtle, { status: 200, headers });
}

/**
 * Extract owner username from a resource IRI.
 */
function extractOwnerFromIri(resourceIri, baseUrl) {
  const path = resourceIri.slice(baseUrl.length + 1);
  const slash = path.indexOf('/');
  return slash > 0 ? path.slice(0, slash) : path;
}

/**
 * Build default ACL N-Triples for a new resource.
 * @param {string} resourceIri
 * @param {string} webId
 * @returns {string}
 */
export function defaultAclNTriples(resourceIri, webId) {
  const acl = PREFIXES.acl;
  const rdf = PREFIXES.rdf;
  const aclId = resourceIri + '.acl#owner';
  const lines = [
    `${iri(aclId)} ${iri(rdf + 'type')} ${iri(acl + 'Authorization')} .`,
    `${iri(aclId)} ${iri(acl + 'agent')} ${iri(webId)} .`,
    `${iri(aclId)} ${iri(acl + 'accessTo')} ${iri(resourceIri)} .`,
    `${iri(aclId)} ${iri(acl + 'mode')} ${iri(acl + 'Read')} .`,
    `${iri(aclId)} ${iri(acl + 'mode')} ${iri(acl + 'Write')} .`,
    `${iri(aclId)} ${iri(acl + 'mode')} ${iri(acl + 'Control')} .`,
  ];
  // Containers also get acl:default so children inherit owner access
  if (resourceIri.endsWith('/')) {
    lines.push(`${iri(aclId)} ${iri(acl + 'default')} ${iri(resourceIri)} .`);
  }
  return lines.join('\n');
}
