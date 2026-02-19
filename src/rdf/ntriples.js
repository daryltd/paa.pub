/**
 * Minimal N-Triples / N-Quads parser and serializer.
 *
 * Handles the subset used by s20e: IRIs, literals (plain, language-tagged,
 * datatyped), and blank nodes.
 */

/**
 * Parse N-Triples/N-Quads string into an array of quad objects.
 * @param {string} text
 * @returns {Array<{subject: string, predicate: string, object: string, graph?: string}>}
 */
export function parseNTriples(text) {
  const quads = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = [];
    let i = 0;
    while (i < trimmed.length && parts.length < 4) {
      if (trimmed[i] === '<') {
        const end = trimmed.indexOf('>', i);
        parts.push(trimmed.slice(i, end + 1));
        i = end + 1;
      } else if (trimmed[i] === '"') {
        let j = i + 1;
        while (j < trimmed.length) {
          if (trimmed[j] === '\\') { j += 2; continue; }
          if (trimmed[j] === '"') break;
          j++;
        }
        // Check for language tag or datatype
        let end = j + 1;
        if (trimmed[end] === '@') {
          while (end < trimmed.length && trimmed[end] !== ' ' && trimmed[end] !== '\t' && trimmed[end] !== '.') end++;
        } else if (trimmed[end] === '^' && trimmed[end + 1] === '^') {
          end += 2;
          if (trimmed[end] === '<') {
            end = trimmed.indexOf('>', end) + 1;
          }
        }
        parts.push(trimmed.slice(i, end));
        i = end;
      } else if (trimmed[i] === '_' && trimmed[i + 1] === ':') {
        let end = i + 2;
        while (end < trimmed.length && trimmed[end] !== ' ' && trimmed[end] !== '\t' && trimmed[end] !== '.') end++;
        parts.push(trimmed.slice(i, end));
        i = end;
      } else if (trimmed[i] === '.') {
        break;
      } else {
        i++;
      }
    }

    if (parts.length >= 3) {
      quads.push({
        subject: parts[0],
        predicate: parts[1],
        object: parts[2],
        graph: parts[3] || undefined,
      });
    }
  }
  return quads;
}

/**
 * Serialize quads to N-Triples (ignoring graph component).
 * @param {Array<{subject: string, predicate: string, object: string}>} triples
 * @returns {string}
 */
export function serializeNTriples(triples) {
  return triples
    .map(t => `${t.subject} ${t.predicate} ${t.object} .`)
    .join('\n');
}

/**
 * Serialize quads to N-Quads (with graph component).
 * @param {Array<{subject: string, predicate: string, object: string, graph?: string}>} quads
 * @returns {string}
 */
export function serializeNQuads(quads) {
  return quads
    .map(q => q.graph
      ? `${q.subject} ${q.predicate} ${q.object} ${q.graph} .`
      : `${q.subject} ${q.predicate} ${q.object} .`)
    .join('\n');
}

/** Wrap an IRI in angle brackets. */
export function iri(value) {
  return `<${value}>`;
}

/** Create a plain string literal. */
export function literal(value) {
  return `"${escapeNTriples(String(value))}"`;
}

/** Create a datatyped literal. */
export function typedLiteral(value, datatype) {
  return `"${escapeNTriples(String(value))}"^^<${datatype}>`;
}

/** Create a language-tagged literal. */
export function langLiteral(value, lang) {
  return `"${escapeNTriples(String(value))}"@${lang}`;
}

/** Extract the IRI from <...> */
export function unwrapIri(term) {
  if (term.startsWith('<') && term.endsWith('>')) {
    return term.slice(1, -1);
  }
  return term;
}

/** Extract the value from "..." */
export function unwrapLiteral(term) {
  const match = term.match(/^"((?:[^"\\]|\\.)*)"/);
  return match ? match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : term;
}

function escapeNTriples(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}
