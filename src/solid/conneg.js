/**
 * Content negotiation for RDF serialization formats.
 *
 * Maps the client's Accept header to the best available serialization:
 *   - `text/turtle` (default) — human-readable RDF with prefix shorthand
 *   - `application/n-triples` — line-based, no prefixes
 *   - `application/ld+json` — JSON-LD (flat structure, basic conversion)
 *
 * Also detects ActivityPub requests (Accept: application/activity+json)
 * so the LDP handler can delegate to the ActivityPub actor handler.
 */
import { serializeTurtle } from '../rdf/turtle-serializer.js';
import { serializeNTriples } from '../rdf/ntriples.js';

/**
 * Determine the best RDF content type from Accept header.
 * @param {string} accept
 * @returns {string} content type
 */
export function negotiateType(accept) {
  if (!accept) return 'text/turtle';
  const lower = accept.toLowerCase();
  if (lower.includes('text/turtle')) return 'text/turtle';
  if (lower.includes('application/ld+json')) return 'application/ld+json';
  if (lower.includes('application/n-triples')) return 'application/n-triples';
  if (lower.includes('application/activity+json')) return 'application/activity+json';
  if (lower.includes('text/html')) return 'text/html';
  return 'text/turtle';
}

/**
 * Check if the Accept header wants ActivityPub JSON.
 * @param {string} accept
 * @returns {boolean}
 */
export function wantsActivityPub(accept) {
  if (!accept) return false;
  const lower = accept.toLowerCase();
  // Only match the AP-specific media type, or JSON-LD with the ActivityStreams profile
  if (lower.includes('application/activity+json')) return true;
  if (lower.includes('application/ld+json') && lower.includes('activitystreams')) return true;
  return false;
}

/**
 * Serialize triples to the requested format.
 * @param {Array<{subject: string, predicate: string, object: string}>} triples
 * @param {string} contentType
 * @param {string[]} [prefixes]
 * @returns {string}
 */
export function serializeRdf(triples, contentType, prefixes = ['rdf', 'rdfs', 'ldp', 'foaf', 'acl', 'solid', 'dcterms', 'vcard', 'space']) {
  switch (contentType) {
    case 'text/turtle':
      return serializeTurtle(triples, prefixes);
    case 'application/n-triples':
      return serializeNTriples(triples);
    case 'application/ld+json':
      return triplesToJsonLd(triples);
    default:
      return serializeTurtle(triples, prefixes);
  }
}

function triplesToJsonLd(triples) {
  // Minimal JSON-LD: flat array of statements
  const subjects = new Map();
  for (const t of triples) {
    const s = unwrap(t.subject);
    if (!subjects.has(s)) subjects.set(s, { '@id': s });
    const node = subjects.get(s);
    const p = unwrap(t.predicate);
    if (p === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type') {
      if (!node['@type']) node['@type'] = [];
      node['@type'].push(unwrap(t.object));
    } else {
      if (!node[p]) node[p] = [];
      node[p].push(parseObject(t.object));
    }
  }
  return JSON.stringify([...subjects.values()], null, 2);
}

function unwrap(term) {
  if (term.startsWith('<') && term.endsWith('>')) return term.slice(1, -1);
  return term;
}

function parseObject(term) {
  if (term.startsWith('<') && term.endsWith('>')) {
    return { '@id': term.slice(1, -1) };
  }
  const litMatch = term.match(/^"((?:[^"\\]|\\.)*)"(?:@(\S+)|\^\^<([^>]+)>)?/);
  if (litMatch) {
    const obj = { '@value': litMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') };
    if (litMatch[2]) obj['@language'] = litMatch[2];
    if (litMatch[3]) obj['@type'] = litMatch[3];
    return obj;
  }
  return { '@value': term };
}
