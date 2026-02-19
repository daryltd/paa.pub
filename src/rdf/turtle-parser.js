/**
 * Minimal Turtle parser.
 *
 * Handles the subset used by ACLs, profiles, and LDP containers:
 * - @prefix declarations
 * - Subject-predicate-object triples with ; and , shorthand
 * - IRI refs (<...>), prefixed names (prefix:local), literals, blank nodes
 * - a → rdf:type
 */

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

/**
 * Parse a Turtle string into triples.
 * @param {string} text
 * @param {string} [baseIri] - base IRI for relative references
 * @returns {Array<{subject: string, predicate: string, object: string}>}
 */
export function parseTurtle(text, baseIri = '') {
  const prefixes = {};
  const triples = [];
  let pos = 0;

  function skipWS() {
    while (pos < text.length) {
      if (text[pos] === '#') {
        while (pos < text.length && text[pos] !== '\n') pos++;
      } else if (' \t\n\r'.includes(text[pos])) {
        pos++;
      } else break;
    }
  }

  function readIri() {
    if (text[pos] !== '<') return null;
    pos++;
    let iri = '';
    while (pos < text.length && text[pos] !== '>') {
      if (text[pos] === '\\') { pos++; iri += text[pos++]; continue; }
      iri += text[pos++];
    }
    pos++; // skip >
    if (iri.startsWith('http://') || iri.startsWith('https://') || iri.startsWith('urn:')) return iri;
    if (iri.startsWith('#')) return baseIri + iri;
    if (iri === '') return baseIri;
    // Relative IRI
    if (baseIri) {
      const base = new URL(baseIri);
      return new URL(iri, base).href;
    }
    return iri;
  }

  function readPrefixedName() {
    const match = text.slice(pos).match(/^([a-zA-Z_][\w.-]*)?:([\w._~:/?#[\]@!$&'()*+,;=%-]*)/);
    if (!match) return null;
    const prefix = match[1] || '';
    const local = match[2];
    pos += match[0].length;
    const ns = prefixes[prefix];
    if (ns === undefined) return null;
    return ns + local;
  }

  function readLiteral() {
    if (text[pos] !== '"') return null;
    let long = false;
    if (text.slice(pos, pos + 3) === '"""') {
      long = true;
      pos += 3;
    } else {
      pos++;
    }
    let value = '';
    while (pos < text.length) {
      if (text[pos] === '\\') {
        pos++;
        const c = text[pos++];
        if (c === 'n') value += '\n';
        else if (c === 't') value += '\t';
        else if (c === 'r') value += '\r';
        else if (c === '"') value += '"';
        else if (c === '\\') value += '\\';
        else value += c;
        continue;
      }
      if (long && text.slice(pos, pos + 3) === '"""') { pos += 3; break; }
      if (!long && text[pos] === '"') { pos++; break; }
      value += text[pos++];
    }

    // Check for language tag or datatype
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    if (text[pos] === '@') {
      pos++;
      const lm = text.slice(pos).match(/^[a-zA-Z]+-?[a-zA-Z0-9]*/);
      const lang = lm ? lm[0] : '';
      pos += lang.length;
      return `"${escaped}"@${lang}`;
    }
    if (text[pos] === '^' && text[pos + 1] === '^') {
      pos += 2;
      skipWS();
      const dt = text[pos] === '<' ? readIri() : readPrefixedName();
      return `"${escaped}"^^<${dt}>`;
    }
    return `"${escaped}"`;
  }

  function readBlankNode() {
    if (text[pos] === '_' && text[pos + 1] === ':') {
      const m = text.slice(pos).match(/^_:[a-zA-Z0-9_.]+/);
      if (m) { pos += m[0].length; return m[0]; }
    }
    return null;
  }

  function readTerm() {
    skipWS();
    if (pos >= text.length) return null;
    if (text[pos] === '<') return `<${readIri()}>`;
    if (text[pos] === '"') return readLiteral();
    if (text[pos] === '_' && text[pos + 1] === ':') return readBlankNode();
    if (text[pos] === 'a' && /[\s;,.]/.test(text[pos + 1] || '')) {
      pos++;
      return `<${RDF_TYPE}>`;
    }
    // Try prefixed name
    const pn = readPrefixedName();
    if (pn !== null) return `<${pn}>`;
    return null;
  }

  while (pos < text.length) {
    skipWS();
    if (pos >= text.length) break;

    // @prefix
    if (text.slice(pos, pos + 7) === '@prefix') {
      pos += 7;
      skipWS();
      const pm = text.slice(pos).match(/^([a-zA-Z_][\w.-]*)?:/);
      const prefix = pm ? (pm[1] || '') : '';
      pos += pm[0].length;
      skipWS();
      const ns = readIri();
      skipWS();
      if (text[pos] === '.') pos++;
      prefixes[prefix] = ns;
      continue;
    }

    // @base
    if (text.slice(pos, pos + 5) === '@base') {
      pos += 5;
      skipWS();
      baseIri = readIri();
      skipWS();
      if (text[pos] === '.') pos++;
      continue;
    }

    // PREFIX (SPARQL-style)
    if (text.slice(pos, pos + 6).toUpperCase() === 'PREFIX') {
      pos += 6;
      skipWS();
      const pm = text.slice(pos).match(/^([a-zA-Z_][\w.-]*)?:/);
      const prefix = pm ? (pm[1] || '') : '';
      pos += pm[0].length;
      skipWS();
      const ns = readIri();
      prefixes[prefix] = ns;
      continue;
    }

    // Read triple
    const subject = readTerm();
    if (!subject) { pos++; continue; }

    skipWS();
    let predicate = readTerm();
    if (!predicate) break;

    while (true) {
      skipWS();
      let object = readTerm();
      if (!object) break;

      triples.push({ subject, predicate, object });

      skipWS();
      if (text[pos] === ',') {
        pos++; // same subject + predicate, next object
        continue;
      }
      if (text[pos] === ';') {
        pos++; // same subject, new predicate
        skipWS();
        if (text[pos] === '.') { pos++; break; } // ; . ending
        predicate = readTerm();
        if (!predicate) break;
        continue;
      }
      if (text[pos] === '.') {
        pos++;
        break;
      }
      break;
    }
  }

  return triples;
}
