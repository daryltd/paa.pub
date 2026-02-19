/**
 * Minimal Turtle serializer.
 *
 * Groups triples by subject, uses ; and , shorthand, and emits prefix declarations.
 */
import { PREFIXES } from './prefixes.js';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

/**
 * Serialize triples to Turtle.
 * @param {Array<{subject: string, predicate: string, object: string}>} triples
 * @param {string[]} [prefixNames] - which prefixes to emit (e.g. ['acl', 'foaf'])
 * @returns {string}
 */
export function serializeTurtle(triples, prefixNames = []) {
  if (triples.length === 0) return '';

  // Determine which prefixes are actually used
  const usedPrefixes = {};
  const prefixMap = {};
  for (const name of prefixNames) {
    if (PREFIXES[name]) prefixMap[PREFIXES[name]] = name;
  }

  function shorten(term) {
    // IRI wrapped in < >
    if (term.startsWith('<') && term.endsWith('>')) {
      const iri = term.slice(1, -1);
      if (iri === RDF_TYPE) return 'a';
      for (const [ns, prefix] of Object.entries(prefixMap)) {
        if (iri.startsWith(ns)) {
          usedPrefixes[prefix] = ns;
          return `${prefix}:${iri.slice(ns.length)}`;
        }
      }
      return term;
    }
    // Literal or blank node — return as-is
    return term;
  }

  // Group by subject
  const bySubject = new Map();
  for (const t of triples) {
    if (!bySubject.has(t.subject)) bySubject.set(t.subject, []);
    bySubject.get(t.subject).push(t);
  }

  const lines = [];

  // Emit prefix declarations
  for (const name of prefixNames) {
    if (PREFIXES[name]) {
      lines.push(`@prefix ${name}: <${PREFIXES[name]}> .`);
    }
  }
  if (lines.length > 0) lines.push('');

  // Emit triples grouped by subject
  for (const [subject, subjectTriples] of bySubject) {
    const s = shorten(subject);

    // Group by predicate
    const byPredicate = new Map();
    for (const t of subjectTriples) {
      if (!byPredicate.has(t.predicate)) byPredicate.set(t.predicate, []);
      byPredicate.get(t.predicate).push(t.object);
    }

    const predicates = [...byPredicate.entries()];
    for (let pi = 0; pi < predicates.length; pi++) {
      const [pred, objects] = predicates[pi];
      const p = shorten(pred);
      const objStr = objects.map(o => shorten(o)).join(', ');
      const ending = pi < predicates.length - 1 ? ' ;' : ' .';

      if (pi === 0) {
        lines.push(`${s} ${p} ${objStr}${ending}`);
      } else {
        lines.push(`    ${p} ${objStr}${ending}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trim() + '\n';
}
