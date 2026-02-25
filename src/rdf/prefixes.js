/**
 * Common RDF prefix definitions.
 */
export const PREFIXES = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  ldp: 'http://www.w3.org/ns/ldp#',
  acl: 'http://www.w3.org/ns/auth/acl#',
  acp: 'http://www.w3.org/ns/solid/acp#',
  foaf: 'http://xmlns.com/foaf/0.1/',
  solid: 'http://www.w3.org/ns/solid/terms#',
  dcterms: 'http://purl.org/dc/terms/',
  vcard: 'http://www.w3.org/2006/vcard/ns#',
  space: 'http://www.w3.org/ns/pim/space#',
  schema: 'https://schema.org/',
  as: 'https://www.w3.org/ns/activitystreams#',
  sec: 'https://w3id.org/security#',
};

/** Shorten a full predicate IRI to a prefixed form (e.g. foaf:name). */
export function shortenPredicate(iri, prefixes) {
  const map = prefixes || PREFIXES;
  for (const [prefix, ns] of Object.entries(map)) {
    if (iri.startsWith(ns)) return `${prefix}:${iri.slice(ns.length)}`;
  }
  return iri;
}

/**
 * Load a user's custom IRI prefix map from paa_custom/iri_map.json.
 * Returns PREFIXES merged with the custom map (custom entries take precedence).
 */
export async function loadMergedPrefixes(storage, baseUrl, username) {
  const customMap = await loadCustomIriMap(storage, baseUrl, username);
  return { ...PREFIXES, ...customMap };
}

async function loadCustomIriMap(storage, baseUrl, username) {
  try {
    const iriMapIri = `${baseUrl}/${username}/paa_custom/iri_map.json`;
    const idx = await storage.get(`idx:${iriMapIri}`);
    if (!idx) return {};
    const parsed = JSON.parse(idx);
    if (!parsed.binary) return {};
    const blob = await storage.getBlob(`blob:${iriMapIri}`);
    if (!blob) return {};
    const map = JSON.parse(new TextDecoder().decode(blob));
    if (typeof map !== 'object' || map === null || Array.isArray(map)) return {};
    return map;
  } catch (e) {
    return {};
  }
}

/** Build a prefix header for Turtle serialization. */
export function turtlePrefixes(prefixNames) {
  return prefixNames
    .filter(name => PREFIXES[name])
    .map(name => `@prefix ${name}: <${PREFIXES[name]}> .`)
    .join('\n');
}
