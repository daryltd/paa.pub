/**
 * Container membership management via ldp:contains.
 */
import { PREFIXES } from '../rdf/prefixes.js';
import { iri } from '../rdf/ntriples.js';

/**
 * Build N-Quads to add a resource to a container.
 * @param {string} containerIri
 * @param {string} resourceIri
 * @returns {string} N-Quads line
 */
export function addContainment(containerIri, resourceIri) {
  return `${iri(containerIri)} ${iri(PREFIXES.ldp + 'contains')} ${iri(resourceIri)} ${iri(containerIri)} .`;
}

/**
 * Build N-Quads to remove a resource from a container.
 * @param {string} containerIri
 * @param {string} resourceIri
 * @returns {string} N-Quads line
 */
export function removeContainment(containerIri, resourceIri) {
  return `${iri(containerIri)} ${iri(PREFIXES.ldp + 'contains')} ${iri(resourceIri)} ${iri(containerIri)} .`;
}

/**
 * Build container type triples in N-Quads.
 * @param {string} containerIri
 * @returns {string}
 */
export function containerTypeQuads(containerIri) {
  return [
    `${iri(containerIri)} ${iri(PREFIXES.rdf + 'type')} ${iri(PREFIXES.ldp + 'BasicContainer')} ${iri(containerIri)} .`,
    `${iri(containerIri)} ${iri(PREFIXES.rdf + 'type')} ${iri(PREFIXES.ldp + 'Container')} ${iri(containerIri)} .`,
    `${iri(containerIri)} ${iri(PREFIXES.rdf + 'type')} ${iri(PREFIXES.ldp + 'Resource')} ${iri(containerIri)} .`,
  ].join('\n');
}

/**
 * Determine the parent container IRI from a resource IRI.
 * @param {string} resourceIri
 * @returns {string|null}
 */
export function parentContainer(resourceIri) {
  const url = new URL(resourceIri);
  const path = url.pathname;
  if (path === '/' || path === '') return null;
  // For containers ending in /, go up one level
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const lastSlash = trimmed.lastIndexOf('/');
  if (lastSlash < 0) return null;
  return `${url.origin}${trimmed.slice(0, lastSlash + 1)}`;
}

/**
 * Check if a resource IRI represents a container.
 * @param {string} resourceIri
 * @returns {boolean}
 */
export function isContainer(resourceIri) {
  return resourceIri.endsWith('/');
}

/**
 * Generate a slug-based resource name.
 * @param {string} slug
 * @param {boolean} asContainer
 * @returns {string}
 */
export function slugToName(slug, asContainer) {
  // Sanitize slug
  const clean = slug.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-');
  return asContainer ? (clean.endsWith('/') ? clean : clean + '/') : clean;
}
