/**
 * sparq WASM wrapper — thin interface over the sparq triplestore/SPARQL engine.
 *
 * Provides parseTurtle/parseNTriples that return the same triple shape
 * as the existing hand-rolled parsers, plus SPARQL query/update helpers.
 *
 * Runtime detection:
 *   - Cloudflare Workers: WASM imported via Wrangler bundler
 *   - Deno: WASM loaded from disk via Deno.readFile()
 */
import { initSync, Store } from '../pkg/sparq_wasm.js';
import wasmModule from '../pkg/sparq_wasm_bg.wasm';

// Initialize WASM at module load time.
// On Cloudflare: Wrangler compiles the .wasm import to a WebAssembly.Module.
// On Deno: the import will fail, so we fall back to Deno.readFileSync.
let initialized = false;
try {
  if (wasmModule) {
    initSync({ module: wasmModule });
    initialized = true;
  }
} catch (_) {}

if (!initialized && typeof Deno !== 'undefined') {
  const wasmPath = new URL('../pkg/sparq_wasm_bg.wasm', import.meta.url);
  const wasmBytes = Deno.readFileSync(wasmPath);
  initSync({ module: new WebAssembly.Module(wasmBytes) });
  initialized = true;
}

/**
 * Initialize sparq WASM for Cloudflare Workers.
 * Must be called with the imported WASM module before any parsing.
 * No-op on Deno (already initialized above).
 */
export function initSparq(wasmModule) {
  if (initialized) return;
  initSync({ module: wasmModule });
  initialized = true;
}

export function createStore() {
  return Store.load('', 'turtle');
}

export function loadStore(text, format) {
  return Store.load(text, format);
}

/**
 * Parse Turtle text into the standard triple shape.
 * @param {string} text
 * @param {string} [baseIri]
 * @returns {Array<{subject: string, predicate: string, object: string}>}
 */
export function parseTurtleSparq(text, baseIri = '') {
  if (!text || !text.trim()) return [];
  let input = text;
  if (baseIri && !text.match(/^@base\s/m) && !text.match(/^BASE\s/mi)) {
    input = `@base <${baseIri}> .\n${text}`;
  }
  const store = Store.load(input, 'turtle');
  return storeToTriples(store);
}

export function parseNTriplesSparq(text) {
  if (!text || !text.trim()) return [];
  const store = Store.load(text, 'ntriples');
  return storeToTriples(store);
}

export function applySparqlUpdate(existingNTriples, sparqlUpdate) {
  let store = Store.load(existingNTriples || '', 'ntriples');
  store.updateInPlace(sparqlUpdate);
  return storeToTriples(store);
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
