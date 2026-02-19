/**
 * ACL resource management for Solid WAC.
 */
import { PREFIXES } from '../rdf/prefixes.js';
import { iri } from '../rdf/ntriples.js';
import { parseTurtle } from '../rdf/turtle-parser.js';
import { serializeTurtle } from '../rdf/turtle-serializer.js';
import { parseNTriples, serializeNTriples } from '../rdf/ntriples.js';
import { solidHeaders } from './headers.js';
import { negotiateType, serializeRdf } from './conneg.js';

/**
 * Handle GET for .acl resources.
 * @param {object} reqCtx
 * @param {string} resourceIri - IRI of the resource (without .acl)
 * @returns {Promise<Response>}
 */
export async function handleAclGet(reqCtx, resourceIri) {
  const { storage, request, config } = reqCtx;
  const aclIri = resourceIri + '.acl';

  // Check access — only owner can read ACLs
  if (reqCtx.user !== config.username) {
    return new Response('Forbidden', { status: 403 });
  }

  const aclData = await storage.get(`acl:${resourceIri}`);
  if (!aclData) {
    return new Response('Not Found', { status: 404 });
  }

  const triples = parseNTriples(aclData);
  const accept = request.headers.get('Accept') || 'text/turtle';
  const contentType = negotiateType(accept);
  const body = serializeRdf(triples, contentType, ['acl', 'foaf']);

  const headers = solidHeaders(aclIri, false);
  headers.set('Content-Type', contentType);
  return new Response(body, { status: 200, headers });
}

/**
 * Handle PUT for .acl resources.
 * @param {object} reqCtx
 * @param {string} resourceIri
 * @returns {Promise<Response>}
 */
export async function handleAclPut(reqCtx, resourceIri) {
  const { request, storage, config } = reqCtx;

  if (reqCtx.user !== config.username) {
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

  const ntriples = serializeNTriples(triples);
  await storage.put(`acl:${resourceIri}`, ntriples);

  return new Response(null, { status: 205 });
}

/**
 * Handle DELETE for .acl resources.
 * @param {object} reqCtx
 * @param {string} resourceIri
 * @returns {Promise<Response>}
 */
export async function handleAclDelete(reqCtx, resourceIri) {
  if (reqCtx.user !== reqCtx.config.username) {
    return new Response('Forbidden', { status: 403 });
  }
  await reqCtx.storage.delete(`acl:${resourceIri}`);
  return new Response(null, { status: 204 });
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
  return [
    `${iri(aclId)} ${iri(rdf + 'type')} ${iri(acl + 'Authorization')} .`,
    `${iri(aclId)} ${iri(acl + 'agent')} ${iri(webId)} .`,
    `${iri(aclId)} ${iri(acl + 'accessTo')} ${iri(resourceIri)} .`,
    `${iri(aclId)} ${iri(acl + 'mode')} ${iri(acl + 'Read')} .`,
    `${iri(aclId)} ${iri(acl + 'mode')} ${iri(acl + 'Write')} .`,
    `${iri(aclId)} ${iri(acl + 'mode')} ${iri(acl + 'Control')} .`,
  ].join('\n');
}
