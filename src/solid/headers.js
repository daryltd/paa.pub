/**
 * Solid protocol headers: Link, WAC-Allow, Accept-*.
 */
import { PREFIXES } from '../rdf/prefixes.js';

/**
 * Build Link headers for a resource.
 * @param {string} resourceIri
 * @param {boolean} isContainer
 * @returns {string}
 */
export function buildLinkHeaders(resourceIri, isContainer) {
  const links = [
    `<${PREFIXES.ldp}Resource>; rel="type"`,
    `<${resourceIri}.acl>; rel="acl"`,
    `<${resourceIri}.acr>; rel="http://www.w3.org/ns/solid/acp#accessControl"`,
    `<${resourceIri}.meta>; rel="describedby"`,
  ];
  if (isContainer) {
    links.push(`<${PREFIXES.ldp}BasicContainer>; rel="type"`);
    links.push(`<${PREFIXES.ldp}Container>; rel="type"`);
  }
  return links.join(', ');
}

/**
 * Build WAC-Allow header based on access levels.
 * @param {object} access
 * @param {string[]} access.user - modes for authenticated user
 * @param {string[]} access.public - modes for unauthenticated
 * @returns {string}
 */
export function buildWacAllow(access) {
  const userModes = access.user.join(' ');
  const publicModes = access.public.join(' ');
  return `user="${userModes}",public="${publicModes}"`;
}

/**
 * Standard Solid response headers for a resource.
 * @param {string} resourceIri
 * @param {boolean} isContainer
 * @returns {Headers}
 */
export function solidHeaders(resourceIri, isContainer) {
  const headers = new Headers();
  headers.set('Link', buildLinkHeaders(resourceIri, isContainer));
  headers.set('Accept-Patch', 'application/sparql-update');
  headers.set('Accept-Post', 'text/turtle, application/ld+json, application/n-triples, application/octet-stream');
  const methods = isContainer
    ? 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS'
    : 'GET, HEAD, PUT, PATCH, DELETE, OPTIONS';
  headers.set('Allow', methods);
  headers.set('MS-Author-Via', 'SPARQL');
  return headers;
}
