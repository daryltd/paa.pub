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

/** Build a prefix header for Turtle serialization. */
export function turtlePrefixes(prefixNames) {
  return prefixNames
    .filter(name => PREFIXES[name])
    .map(name => `@prefix ${name}: <${PREFIXES[name]}> .`)
    .join('\n');
}
