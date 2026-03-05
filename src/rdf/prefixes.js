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
 * Load a user's custom prefix map from KV (APPDATA).
 * Returns the parsed object or {} if not found.
 */
export async function loadCustomPrefixes(kv, username) {
  try {
    const raw = await kv.get(`custom_prefixes:${username}`);
    if (!raw) return {};
    const map = JSON.parse(raw);
    if (typeof map !== 'object' || map === null || Array.isArray(map)) return {};
    return map;
  } catch (e) {
    return {};
  }
}

/**
 * Save a user's custom prefix map to KV (APPDATA).
 */
export async function saveCustomPrefixes(kv, username, prefixMap) {
  await kv.put(`custom_prefixes:${username}`, JSON.stringify(prefixMap));
}

/**
 * Load built-in PREFIXES merged with user's custom prefixes.
 * Custom entries take precedence.
 */
export async function loadMergedPrefixes(kv, username) {
  const customMap = await loadCustomPrefixes(kv, username);
  return { ...PREFIXES, ...customMap };
}

// --- Namespace predicate catalog ---

/** Helper to build predicate entries from a namespace + local names. */
function ns(base, names) {
  return names.map(n => ({ iri: base + n, label: n }));
}

/**
 * Built-in known predicates for common namespaces.
 * These serve as defaults when no KV-stored predicates exist.
 */
export const BUILTIN_NS_PREDICATES = {
  [PREFIXES.rdf]: ns(PREFIXES.rdf, [
    'type', 'value', 'first', 'rest',
  ]),
  [PREFIXES.rdfs]: ns(PREFIXES.rdfs, [
    'label', 'comment', 'seeAlso', 'isDefinedBy', 'domain', 'range',
    'subClassOf', 'subPropertyOf', 'member',
  ]),
  [PREFIXES.foaf]: ns(PREFIXES.foaf, [
    'name', 'nick', 'img', 'mbox', 'homepage', 'knows', 'interest',
    'account', 'depiction', 'familyName', 'givenName', 'title',
    'based_near', 'age', 'birthday', 'gender', 'workplaceHomepage',
    'schoolHomepage', 'topic_interest', 'currentProject', 'pastProject',
    'weblog', 'logo', 'phone', 'openid', 'isPrimaryTopicOf',
    'primaryTopic', 'member', 'publications', 'thumbnail', 'maker',
    'made', 'sha1', 'mbox_sha1sum',
  ]),
  [PREFIXES.schema]: ns(PREFIXES.schema, [
    'name', 'description', 'url', 'image', 'email', 'telephone',
    'address', 'sameAs', 'knows', 'jobTitle', 'worksFor', 'alumniOf',
    'memberOf', 'award', 'birthDate', 'gender', 'nationality',
    'homeLocation', 'workLocation', 'affiliation', 'colleague',
    'givenName', 'familyName', 'additionalName', 'honorificPrefix',
    'honorificSuffix', 'identifier', 'about', 'author', 'creator',
    'dateCreated', 'dateModified', 'contactPoint',
  ]),
  [PREFIXES.vcard]: ns(PREFIXES.vcard, [
    'fn', 'hasEmail', 'hasTelephone', 'hasAddress', 'hasURL', 'hasPhoto',
    'hasLogo', 'hasGeo', 'hasOrganizationName', 'hasOrganizationUnit',
    'note', 'role', 'title', 'nickname', 'bday', 'category',
    'country-name', 'locality', 'postal-code', 'region',
    'street-address',
  ]),
  [PREFIXES.dcterms]: ns(PREFIXES.dcterms, [
    'title', 'description', 'subject', 'creator', 'publisher',
    'contributor', 'date', 'type', 'format', 'identifier', 'source',
    'language', 'rights', 'created', 'modified', 'license', 'abstract',
    'alternative', 'issued', 'extent', 'hasPart', 'isPartOf',
  ]),
  [PREFIXES.solid]: ns(PREFIXES.solid, [
    'oidcIssuer', 'account', 'publicTypeIndex', 'privateTypeIndex',
    'storageDescription', 'inbox', 'notification',
  ]),
  [PREFIXES.as]: ns(PREFIXES.as, [
    'actor', 'object', 'target', 'content', 'summary', 'name', 'url',
    'published', 'updated', 'inReplyTo', 'tag', 'attachment',
    'attributedTo', 'audience', 'generator', 'icon', 'image', 'location',
    'following', 'followers', 'liked', 'likes', 'shares', 'inbox',
    'outbox', 'preferredUsername', 'manuallyApprovesFollowers',
    'sensitive', 'movedTo', 'alsoKnownAs',
  ]),
  [PREFIXES.ldp]: ns(PREFIXES.ldp, [
    'contains', 'member', 'inbox', 'membershipResource',
    'hasMemberRelation',
  ]),
  [PREFIXES.acl]: ns(PREFIXES.acl, [
    'owner', 'agent', 'agentClass', 'agentGroup', 'accessTo', 'default',
    'mode',
  ]),
  [PREFIXES.space]: ns(PREFIXES.space, [
    'storage', 'preferencesFile', 'workspace',
  ]),
};

/**
 * Load stored predicates for a namespace from KV.
 * Falls back to BUILTIN_NS_PREDICATES if no custom data is stored.
 */
async function loadNsPredicates(kv, nsIri) {
  try {
    const raw = await kv.get(`ns_predicates:${nsIri}`);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return BUILTIN_NS_PREDICATES[nsIri] || [];
}

/**
 * Save discovered predicates for a namespace to KV.
 */
export async function saveNsPredicates(kv, nsIri, predicates) {
  await kv.put(`ns_predicates:${nsIri}`, JSON.stringify(predicates));
}

/**
 * Load the full predicate catalog for all registered namespaces.
 * Returns { nsIri: { prefix, predicates: [{iri, label}] } }
 */
export async function loadPredicateCatalog(kv, prefixMap) {
  const catalog = {};
  for (const [prefix, nsIri] of Object.entries(prefixMap)) {
    const predicates = await loadNsPredicates(kv, nsIri);
    catalog[nsIri] = { prefix, predicates };
  }
  return catalog;
}

/**
 * Discover predicates by fetching and parsing a namespace IRI.
 * Fetches the namespace URL with RDF content negotiation, parses the
 * response (Turtle, N-Triples, or RDF/XML), and extracts property definitions.
 * Returns array of {iri, label} or empty array on failure.
 */
export async function discoverNsPredicates(nsIri) {
  const PROPERTY_TYPES = new Set([
    'http://www.w3.org/1999/02/22-rdf-syntax-ns#Property',
    'http://www.w3.org/2002/07/owl#ObjectProperty',
    'http://www.w3.org/2002/07/owl#DatatypeProperty',
    'http://www.w3.org/2002/07/owl#AnnotationProperty',
    'http://www.w3.org/2002/07/owl#FunctionalProperty',
    'http://www.w3.org/2002/07/owl#InverseFunctionalProperty',
    'http://www.w3.org/2002/07/owl#TransitiveProperty',
    'http://www.w3.org/2002/07/owl#SymmetricProperty',
  ]);
  const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
  const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
  const RDFS_DOMAIN = 'http://www.w3.org/2000/01/rdf-schema#domain';
  const RDFS_RANGE = 'http://www.w3.org/2000/01/rdf-schema#range';

  function unwrap(term) {
    if (term.startsWith('<') && term.endsWith('>')) return term.slice(1, -1);
    return term;
  }
  function unwrapLit(term) {
    if (term.startsWith('"')) {
      const end = term.indexOf('"', 1);
      return end > 0 ? term.slice(1, end) : term;
    }
    return term;
  }

  // Strip the fragment from the namespace IRI to get the fetchable URL
  const baseUrl = nsIri.includes('#') ? nsIri.slice(0, nsIri.indexOf('#')) : nsIri;

  // Try multiple URL variants — some servers have broken HTTPS certs
  const urls = [baseUrl];
  if (baseUrl.startsWith('http://')) {
    urls.push(baseUrl.replace('http://', 'https://'));
  } else if (baseUrl.startsWith('https://')) {
    urls.push(baseUrl.replace('https://', 'http://'));
  }

  let body = null;
  let ct = '';
  for (const fetchUrl of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(fetchUrl, {
        headers: {
          'Accept': 'application/rdf+xml, text/turtle;q=0.9, application/n-triples;q=0.8, text/n3;q=0.7',
          'User-Agent': 'PAA-Solid/1.0 (RDF namespace discovery)',
        },
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeout);
      if (resp.ok) {
        ct = resp.headers.get('content-type') || '';
        body = await resp.text();
        break;
      }
    } catch (e) {
      // Try next URL variant
    }
  }

  if (!body) return [];

  try {

    // Try RDF/XML first (many ontologies use this format)
    if (ct.includes('rdf+xml') || ct.includes('application/xml') || ct.includes('text/xml') ||
        body.trimStart().startsWith('<?xml') || body.includes('rdf:RDF')) {
      const results = extractPropertiesFromRdfXml(body, nsIri);
      if (results.length > 0) return results;
    }

    // Try Turtle / N-Triples parsing
    let triples = [];
    if (ct.includes('turtle') || ct.includes('n3')) {
      const { parseTurtle } = await import('./turtle-parser.js');
      triples = parseTurtle(body, nsIri);
    } else if (ct.includes('n-triples')) {
      const { parseNTriples } = await import('./ntriples.js');
      triples = parseNTriples(body);
    } else {
      // Try turtle as fallback
      try {
        const { parseTurtle } = await import('./turtle-parser.js');
        triples = parseTurtle(body, nsIri);
      } catch (e) {
        return [];
      }
    }

    if (triples.length === 0) return [];

    // Find all subjects typed as properties, or having domain/range
    const propertyIris = new Set();
    const labels = new Map();

    for (const t of triples) {
      const subj = unwrap(t.subject);
      const pred = unwrap(t.predicate);
      const obj = unwrap(t.object);

      if (pred === RDF_TYPE && PROPERTY_TYPES.has(obj)) {
        propertyIris.add(subj);
      }
      if (pred === RDFS_DOMAIN || pred === RDFS_RANGE) {
        propertyIris.add(subj);
      }
      if (pred === RDFS_LABEL) {
        labels.set(subj, unwrapLit(t.object));
      }
    }

    // Filter to only properties whose IRI starts with this namespace
    const results = [];
    for (const iri of propertyIris) {
      if (!iri.startsWith(nsIri)) continue;
      const localName = iri.slice(nsIri.length);
      if (!localName) continue;
      results.push({
        iri,
        label: labels.get(iri) || localName,
      });
    }

    results.sort((a, b) => a.label.localeCompare(b.label));
    return results.slice(0, 200);
  } catch (e) {
    return [];
  }
}

/**
 * Extract property definitions from an RDF/XML document.
 * Handles DOCTYPE entity expansion and finds rdf:Property / owl:*Property
 * elements with their rdf:about IRIs and rdfs:label values.
 */
function extractPropertiesFromRdfXml(body, nsIri) {
  // Parse DOCTYPE entity declarations
  const entities = {};
  const entityRe = /<!ENTITY\s+(\w+)\s+['"]([^'"]*)['"]\s*>/g;
  let m;
  while ((m = entityRe.exec(body)) !== null) {
    entities[m[1]] = m[2];
  }

  function expandEntities(str) {
    return str.replace(/&(\w+);/g, (_, name) => entities[name] || `&${name};`);
  }

  // Property type element names to look for (with any XML prefix)
  const propTypePatterns = [
    'rdf:Property', 'Property',
    'owl:ObjectProperty', 'ObjectProperty',
    'owl:DatatypeProperty', 'DatatypeProperty',
    'owl:AnnotationProperty', 'AnnotationProperty',
    'owl:FunctionalProperty', 'FunctionalProperty',
    'owl:InverseFunctionalProperty', 'InverseFunctionalProperty',
    'owl:TransitiveProperty', 'TransitiveProperty',
    'owl:SymmetricProperty', 'SymmetricProperty',
  ];

  const results = [];
  const seen = new Set();

  for (const pType of propTypePatterns) {
    // Match the opening tag and capture everything until the closing tag or self-close
    const escaped = pType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match full element (self-closing or with body)
    const re = new RegExp('<' + escaped + '\\b([^>]*)(?:/>|>([\\s\\S]*?)</' + escaped + '\\s*>)', 'g');

    while ((m = re.exec(body)) !== null) {
      const attrs = m[1];
      const elementBody = m[2] || '';

      // Extract rdf:about
      const aboutMatch = attrs.match(/rdf:about\s*=\s*"([^"]*)"/);
      if (!aboutMatch) continue;
      const iri = expandEntities(aboutMatch[1]);

      if (!iri.startsWith(nsIri)) continue;
      if (seen.has(iri)) continue;
      seen.add(iri);

      // Try to extract rdfs:label from attributes first, then from child elements
      let label = null;
      const labelAttr = attrs.match(/rdfs:label\s*=\s*"([^"]*)"/);
      if (labelAttr) {
        label = expandEntities(labelAttr[1]);
      } else {
        const labelEl = elementBody.match(/rdfs:label\s*=\s*"([^"]*)"/);
        if (labelEl) {
          label = expandEntities(labelEl[1]);
        } else {
          // Try <rdfs:label>text</rdfs:label>
          const labelTag = elementBody.match(/<rdfs:label[^>]*>([^<]*)<\/rdfs:label>/);
          if (labelTag) label = labelTag[1].trim();
        }
      }

      const localName = iri.slice(nsIri.length);
      if (!localName) continue;

      results.push({
        iri,
        label: label || localName,
      });
    }
  }

  results.sort((a, b) => a.label.localeCompare(b.label));
  return results.slice(0, 200);
}
