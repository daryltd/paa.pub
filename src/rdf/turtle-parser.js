/**
 * Turtle parser — delegates to sparq WASM for conformant parsing.
 *
 * Supports the full Turtle spec including collections (), nested blank nodes [],
 * multi-line strings, numeric/boolean literals, and all other features.
 *
 * Returns the same {subject, predicate, object} triple shape as before —
 * all importing files work unchanged.
 */
import { parseTurtleSparq } from './sparq.js';

/**
 * Parse a Turtle string into triples.
 * @param {string} text
 * @param {string} [baseIri] - base IRI for relative references
 * @returns {Array<{subject: string, predicate: string, object: string}>}
 */
export function parseTurtle(text, baseIri = '') {
  return parseTurtleSparq(text, baseIri);
}
