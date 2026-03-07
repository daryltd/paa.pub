/**
 * Solid protocol headers: Link, WAC-Allow, Accept-*.
 */
import { PREFIXES } from '../rdf/prefixes.js';

/**
 * Build Link headers for a resource.
 * @param {string} resourceIri
 * @param {boolean} isContainer
 * @param {boolean} isStorageRoot
 * @returns {string}
 */
export function buildLinkHeaders(resourceIri, isContainer, isStorageRoot) {
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
  if (isStorageRoot) {
    links.push(`<http://www.w3.org/ns/pim/space#Storage>; rel="type"`);
    links.push(`<${resourceIri}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`);
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
 * @param {object} [options]
 * @param {boolean} [options.isStorageRoot] - Whether this is the storage root container
 * @returns {Headers}
 */
export function solidHeaders(resourceIri, isContainer, options = {}) {
  const { isStorageRoot } = options;
  const headers = new Headers();
  headers.set('Link', buildLinkHeaders(resourceIri, isContainer, isStorageRoot));
  headers.set('Accept-Patch', 'application/sparql-update');
  headers.set('Accept-Put', '*/*');
  if (isContainer) {
    headers.set('Accept-Post', 'text/turtle, application/ld+json, application/n-triples, application/octet-stream');
  }
  let methods;
  if (isStorageRoot) {
    methods = 'OPTIONS, HEAD, GET, POST, PUT, PATCH';
  } else if (isContainer) {
    methods = 'OPTIONS, HEAD, GET, POST, PUT, PATCH, DELETE';
  } else {
    methods = 'OPTIONS, HEAD, GET, PUT, PATCH, DELETE';
  }
  headers.set('Allow', methods);
  headers.set('Vary', 'Accept, Authorization, Origin');
  return headers;
}
