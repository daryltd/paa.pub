/**
 * sparq WASM wrapper — thin interface over the sparq triplestore/SPARQL engine.
 *
 * Provides parseTurtle/parseNTriples that return the same triple shape
 * as the existing hand-rolled parsers, plus SPARQL query/update helpers.
 *
 * Runtime detection:
 *   - Deno: WASM loaded from disk via Deno.readFileSync() and self-initialized
 *     below, synchronously — safe since this module is never given a static
 *     or dynamic `.wasm` import to resolve.
 *   - Cloudflare Workers: this module must NOT import the `.wasm` file
 *     itself (statically OR dynamically) — Deno's module resolver chokes on
 *     it regardless of runtime branching, since static imports are resolved
 *     eagerly for the whole graph, and a dynamic import here is slow enough
 *     (real WASM compilation) to exceed Workers' top-level-await budget.
 *     Instead, the Cloudflare-only entry point (index.js) does its own
 *     static import — safe, since Deno never loads that file — and calls
 *     initSparq() with the already-compiled module.
 */
import { initSync, Store } from '../pkg/sparq_wasm.js';

// Initialize WASM at module load time.
let initialized = false;

if (typeof Deno !== 'undefined') {
  // Deno: load WASM from filesystem
  const wasmPath = new URL('../pkg/sparq_wasm_bg.wasm', import.meta.url);
  const wasmBytes = Deno.readFileSync(wasmPath);
  initSync({ module: new WebAssembly.Module(wasmBytes) });
  initialized = true;
}
// Cloudflare Workers: no self-init here — see initSparq() below.

/**
 * Initialize sparq WASM. No-op if already initialized at module load.
 */
export function initSparq(wasmMod) {
  if (initialized) return;
  initSync({ module: wasmMod });
  initialized = true;
}

/**
 * Create a new empty Store.
 */
export function createStore() {
  return new Store();
}

/**
 * Load RDF text into a new Store.
 */
export function loadStore(text, format) {
  return Store.load(text, format);
}

/**
 * Parse Turtle text into the standard triple shape.
 * Uses Store.load_with_base() for proper relative IRI resolution.
 * @param {string} text
 * @param {string} [baseIri]
 * @returns {Array<{subject: string, predicate: string, object: string}>}
 */
export function parseTurtleSparq(text, baseIri = '') {
  if (!text || !text.trim()) return [];
  const store = baseIri
    ? Store.loadWithBase(text, 'turtle', baseIri)
    : Store.load(text, 'turtle');
  return storeToTriples(store);
}

/**
 * Parse N-Triples text into the standard triple shape.
 */
export function parseNTriplesSparq(text) {
  if (!text || !text.trim()) return [];
  const store = Store.load(text, 'ntriples');
  return storeToTriples(store);
}

/**
 * Apply a SPARQL Update to N-Triples data, return the resulting triples.
 */
export function applySparqlUpdate(existingNTriples, sparqlUpdate) {
  let store = existingNTriples ? Store.load(existingNTriples, 'ntriples') : new Store();
  store.updateInPlace(sparqlUpdate);
  return storeToTriples(store);
}

/**
 * Get the triple count of a Store.
 */
export function storeSize(store) {
  return store.size;
}

function storeToTriples(store) {
  const jsonStr = store.query('SELECT ?s ?p ?o WHERE { ?s ?p ?o }');
  const results = JSON.parse(jsonStr);
  if (!results.results || !results.results.bindings) return [];

  return results.results.bindings.map(b => ({
    subject: termToNTriples(b.s),
    predicate: termToNTriples(b.p),
    object: termToNTriples(b.o),
  }));
}

function termToNTriples(term) {
  if (!term) return '';
  switch (term.type) {
    case 'uri':
      return `<${term.value}>`;
    case 'bnode':
      return `_:${term.value}`;
    case 'literal': {
      const escaped = term.value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
      if (term['xml:lang']) return `"${escaped}"@${term['xml:lang']}`;
      if (term.datatype && term.datatype !== 'http://www.w3.org/2001/XMLSchema#string') {
        return `"${escaped}"^^<${term.datatype}>`;
      }
      return `"${escaped}"`;
    }
    default:
      return term.value;
  }
}

export { Store };
