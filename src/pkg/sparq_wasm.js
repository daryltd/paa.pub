/* @ts-self-types="./sparq_wasm.d.ts" */

/**
 * A forward-only cursor over the N-Triples lines of a CONSTRUCT/DESCRIBE result graph
 * (see [`Store::query_quads_chunks`]): each [`next`](Self::next) yields the next batch of
 * up to `batch_size` triples as an N-Triples fragment (which is also valid Turtle —
 * N-Triples ⊂ Turtle). Concatenating every batch reproduces [`Store::query_quads`]'s full
 * document. The graph is materialised once inside wasm, but each batch string is built on
 * demand and not retained, so the JS-side copy is bounded to one batch at a time.
 */
export class QuadChunks {
    static __wrap(ptr) {
        const obj = Object.create(QuadChunks.prototype);
        obj.__wbg_ptr = ptr;
        QuadChunksFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        QuadChunksFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_quadchunks_free(ptr, 0);
    }
    /**
     * The next N-Triples fragment, or `undefined` when the graph is exhausted.
     * @returns {string | undefined}
     */
    next() {
        const ret = wasm.quadchunks_next(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
}
if (Symbol.dispose) QuadChunks.prototype[Symbol.dispose] = QuadChunks.prototype.free;

/**
 * The ordered chunk sequence of one query result (see [`Store::query_chunks`]):
 * concatenating every chunk yields exactly [`Store::query`]'s JSON string. Chunks
 * split only at solution-row boundaries (~64 KiB flushes), so a consumer can parse
 * rows incrementally without ever holding the whole result as one JS string.
 */
export class QueryChunks {
    static __wrap(ptr) {
        const obj = Object.create(QueryChunks.prototype);
        obj.__wbg_ptr = ptr;
        QueryChunksFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        QueryChunksFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_querychunks_free(ptr, 0);
    }
    /**
     * The next chunk, or `undefined` when the sequence is exhausted.
     * @returns {string | undefined}
     */
    next() {
        const ret = wasm.querychunks_next(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
}
if (Symbol.dispose) QueryChunks.prototype[Symbol.dispose] = QueryChunks.prototype.free;

/**
 * A forward-only **cursor over a SELECT result's solution rows** (see
 * [`Store::query_cursor`]): each [`next`](Self::next) yields the next *batch* of up to
 * `batch_size` solutions as a **self-contained** SPARQL 1.1 JSON document — vars in
 * `head`, just that batch's rows in `results.bindings` — so the consumer can `JSON.parse`
 * each batch on its own and process (then drop) it before pulling the next. Unlike
 * [`QueryChunks`], whose chunks are arbitrary byte-cuts of one big JSON string that must
 * be re-joined before parsing, every cursor batch is independently valid. The result is
 * materialised once inside wasm (the engine has no lazy solution iterator at this layer),
 * but each batch's JSON string is built lazily on demand and never retained, so the heavy
 * JS-side string copy is bounded to one batch at a time — never the whole result at once.
 */
export class SolutionCursor {
    static __wrap(ptr) {
        const obj = Object.create(SolutionCursor.prototype);
        obj.__wbg_ptr = ptr;
        SolutionCursorFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SolutionCursorFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_solutioncursor_free(ptr, 0);
    }
    /**
     * The configured batch size (max solutions per [`next`](Self::next)).
     * @returns {number}
     */
    batchSize() {
        const ret = wasm.solutioncursor_batchSize(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * The next batch as a standalone SPARQL 1.1 JSON results document, or `undefined`
     * once every solution has been yielded. A query with zero solutions yields exactly
     * one batch (the empty-`bindings` document) and is then exhausted, so a caller can
     * distinguish "no rows" (one empty batch) from "fully drained" (`undefined`).
     * @returns {string | undefined}
     */
    next() {
        const ret = wasm.solutioncursor_next(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * The total number of solution rows in the (already materialised) result.
     * @returns {number}
     */
    rowCount() {
        const ret = wasm.solutioncursor_rowCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * The projected variable names, in order — the `head.vars` shared by every batch.
     * @returns {string[]}
     */
    vars() {
        const ret = wasm.solutioncursor_vars(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
}
if (Symbol.dispose) SolutionCursor.prototype[Symbol.dispose] = SolutionCursor.prototype.free;

/**
 * An immutable, dictionary-encoded RDF store queryable with SPARQL.
 */
export class Store {
    static __wrap(ptr) {
        const obj = Object.create(Store.prototype);
        obj.__wbg_ptr = ptr;
        StoreFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        StoreFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_store_free(ptr, 0);
    }
    /**
     * Incremental quad-level delta, mirroring `Graph::apply_delta`: parses
     * `inserts` and `deletes` as N-Quads (N-Triples for default-graph data) and
     * applies them as ONE batch — deletes first, then inserts, routed per graph
     * (named graphs auto-created on first insert) — through the delta overlay:
     * O(batch), no rebuild. Blank nodes denote concrete nodes BY LABEL, so bnode
     * triples CAN be retracted (impossible via SPARQL `DELETE DATA`).
     * @param {string} inserts
     * @param {string} deletes
     */
    applyDelta(inserts, deletes) {
        const ptr0 = passStringToWasm0(inserts, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(deletes, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.store_applyDelta(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Answers an **ASK** query as a plain `boolean`, evaluated through the engine's
     * NATIVE ask path ([`sparq_engine::ask`]): the pattern is evaluated under an
     * implicit `LIMIT 1`, so the scan/join **early-exits at the first solution** and
     * nothing is materialised — no SELECT result is built, no SPARQL-JSON string is
     * serialised, and no boolean is parsed back out on the JS side. This is the
     * right entry point for an existence check on a memory-constrained device: prefer
     * it over routing an ASK through [`query`](Self::query) (which would build and
     * serialise the boolean results document) or, worse, rewriting it to a counted
     * `SELECT *`. A non-ASK query (SELECT / CONSTRUCT / DESCRIBE / UPDATE) is rejected
     * with a clear error — use [`query`](Self::query) / [`queryQuads`](Self::query_quads).
     * @param {string} sparql
     * @returns {boolean}
     */
    ask(sparql) {
        const ptr0 = passStringToWasm0(sparql, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.store_ask(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * Like [`ask`](Self::ask) but under a cooperative working-set budget: any
     * intermediate or final materialised result exceeding `maxRows` rows aborts the
     * query with a `"query budget exceeded (max-rows)"` error rather than running to
     * completion. Use it to bound the worst-case memory an adversarial / accidentally
     * huge ASK pattern can take in the browser tab. The early-exit still applies, so a
     * pattern that finds a solution quickly never approaches the cap. (The engine's
     * other budget dimension, a wall-clock deadline, is native-only — `std::time::Instant`
     * is unusable on `wasm32` — so only the portable row cap is exposed here.)
     * @param {string} sparql
     * @param {number} max_rows
     * @returns {boolean}
     */
    askWithMaxRows(sparql, max_rows) {
        const ptr0 = passStringToWasm0(sparql, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.store_askWithMaxRows(this.__wbg_ptr, ptr0, len0, max_rows);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * Counts the solutions of a SELECT query *without* materialising them — for a
     * single-pattern scan or a two-pattern join the count is read straight from
     * the index (no result rows built). Ideal for "how many?" UI queries on a
     * memory-constrained device.
     * @param {string} sparql
     * @returns {number}
     */
    count(sparql) {
        const ptr0 = passStringToWasm0(sparql, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.store_count(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * [OPUS-4.8] sq-ncvq.14: query-plan introspection — `EXPLAIN`.
     *
     * Returns the engine's plan for `sparql` as a human-readable string — the
     * algebra tree plus, per BGP, the chosen join order with cardinality
     * estimates, per-step join strategy and pushed-down filters — **without
     * executing the query** (a planning-only dry run; cheap regardless of the
     * query's run cost). This is the same plan text the Rust API
     * (`sparq_engine::explain`) and the HTTP endpoint (`explain` / `explain=plan`
     * query parameter, or `Accept: text/x-sparq-explain`) return, now exposed to
     * JS consumers so the browser/JS surface has the same plan introspection.
     * Works for every query form (SELECT / ASK / CONSTRUCT / DESCRIBE); use
     * [`explainAnalyze`](Self::explain_analyze) to also run and trace it.
     * @param {string} sparql
     * @returns {string}
     */
    explain(sparql) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(sparql, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.store_explain(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * [OPUS-4.8] sq-ncvq.14: query-plan introspection — `EXPLAIN ANALYZE`.
     *
     * Like [`explain`](Self::explain) but **executes** the query (SELECT / ASK
     * only) and appends a per-operator execution trace — output row count per
     * operator, plus totals — after the plan. The returned string matches the
     * Rust API (`sparq_engine::explain_analyze`) and the HTTP `explain=analyze`
     * response. Wall times read 0 on `wasm32` (no monotonic clock — `Instant` is
     * unusable there); the row counts are exact. A CONSTRUCT / DESCRIBE / UPDATE
     * query is rejected with a clear error — use [`explain`](Self::explain) for
     * the graph-valued forms.
     * @param {string} sparql
     * @returns {string}
     */
    explainAnalyze(sparql) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(sparql, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.store_explainAnalyze(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * A rough estimate of the store's in-memory footprint, in bytes.
     * @returns {number}
     */
    heapBytes() {
        const ret = wasm.store_heapBytes(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Parses an RDF document into a store. `format`: `"turtle"` | `"ntriples"` |
     * `"nquads"` | `"trig"` | `"jsonld"` (also `"json-ld"` / `"application/ld+json"`,
     * available only when the crate is built with the OPT-IN `jsonld` feature — the
     * site REPL bundle enables it; the lean default bundle does not).
     * Named graphs (from N-Quads / TriG / JSON-LD `@graph`) are folded into the default
     * graph — use [`loadDataset`](Self::load_dataset) to preserve them.
     * @param {string} text
     * @param {string} format
     * @returns {Store}
     */
    static load(text, format) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(format, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.store_load(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Store.__wrap(ret[0]);
    }
    /**
     * Like [`load`](Self::load) but stores the index BLOCK-COMPRESSED (~4-6 B/triple vs
     * 12 — roughly half the index memory, measured −49% on the 6-perm set / −60% on the
     * 3-perm compact set the browser uses). Query results are identical; scans pay a
     * bounded per-block decode (+10–33% on large materialised queries). The right default
     * when the device's RAM, not its CPU, is the binding constraint — i.e. fitting a
     * bigger graph in the tab.
     * @param {string} text
     * @param {string} format
     * @returns {Store}
     */
    static loadCompressed(text, format) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(format, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.store_loadCompressed(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Store.__wrap(ret[0]);
    }
    /**
     * Like [`load`](Self::load) but preserves NAMED GRAPHS from N-Quads / TriG / a
     * JSON-LD `@graph` (with an outer `@id`) as
     * separate sub-graphs, so `GRAPH <iri> { … }` / `GRAPH ?g { … }` patterns,
     * `FROM` / `FROM NAMED` dataset clauses, and SPARQL Updates with `GRAPH`
     * blocks (including `CLEAR GRAPH` / `DROP GRAPH`) all see the dataset.
     * Formats without named graphs ("turtle" / "ntriples") load as [`load`](Self::load).
     * [`size`](Self::size) / [`heapBytes`](Self::heap_bytes) report the DEFAULT
     * graph only (count the dataset with `GRAPH ?g` queries).
     * @param {string} text
     * @param {string} format
     * @returns {Store}
     */
    static loadDataset(text, format) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(format, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.store_loadDataset(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Store.__wrap(ret[0]);
    }
    /**
     * [OPUS-4.8] sq-f66jz (#1115): like [`load`](Self::load) but resolves the document's
     * RELATIVE IRIs against `base`.
     *
     * A document fetched from a URL (or a SHACL shapes graph / W3C test manifest addressed
     * by its location) often carries relative IRIs and no `@base` of its own; `base` is the
     * base IRI those resolve against — e.g. `loadWithBase("<a> <p> <o> .", "turtle",
     * "http://example.org/dir/")` interns `<http://example.org/dir/a>` etc. A document-level
     * `@base` directive still overrides the supplied `base` (standard Turtle/TriG scoping).
     * The line-based formats (`"ntriples"` / `"nquads"`) allow only absolute IRIs, so `base`
     * has no effect on them. An invalid `base` (not a syntactically valid IRI) is rejected
     * with a `JsError`. Calls straight through to `sparq_core::Graph::load_str_with_base`,
     * so the resolution is byte-identical to the native loader. Named graphs are folded into
     * the default graph (as [`load`](Self::load)); there is no dataset-preserving base
     * variant at this layer yet.
     * @param {string} text
     * @param {string} format
     * @param {string} base
     * @returns {Store}
     */
    static loadWithBase(text, format, base) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(format, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(base, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.store_loadWithBase(ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Store.__wrap(ret[0]);
    }
    /**
     * [OPUS-4.8] sq-ty78o (#1114): a public **empty, mutable** store — the ergonomic
     * `new Store()` constructor.
     *
     * Until now the only way to obtain a `Store` was a static [`load`](Self::load) /
     * [`loadDataset`](Self::load_dataset) / [`loadCompressed`](Self::load_compressed)
     * factory, so a JS caller who wanted to start from nothing and build the graph up with
     * [`updateInPlace`](Self::update_in_place) / [`applyDelta`](Self::apply_delta) had to
     * reach for `Store.load("", "turtle")`. This exposes the natural `new Store()` spelling,
     * returning an empty graph that is immediately mutable through the engine's delta overlay.
     *
     * **Named graphs work out of the box.** The overlay creates a named graph on the first
     * insert that targets it, so `new Store()` then
     * `updateInPlace("INSERT DATA { GRAPH <g> { … } }")` followed by a `GRAPH ?g { … }`
     * query returns the inserted rows — no dataset-mode flag is required for an *empty*
     * store. (Dataset mode matters only when *loading* an existing document whose named
     * graphs would otherwise be folded into the default graph — use
     * [`loadDataset`](Self::load_dataset) for that.) Equivalent to `Store.load("", "turtle")`,
     * surfaced as a `constructor`.
     */
    constructor() {
        const ret = wasm.store_new();
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        StoreFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Runs a SELECT query and returns the results as a SPARQL 1.1 JSON string
     * (`application/sparql-results+json`). Benefits from the engine's streaming
     * optimisations: LIMIT stops the scan early, numeric FILTERs are pushed into
     * the scan, OPTIONAL uses a sort-merge join, and COUNT(*) is computed from the
     * index without materialising — all of which matter even more in the browser,
     * where memory and main-thread time are scarce.
     * @param {string} sparql
     * @returns {string}
     */
    query(sparql) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(sparql, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.store_query(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Like [`query`](Self::query) but returns the SPARQL 1.1 JSON document as an
     * ordered sequence of ~64 KiB chunks (split only at solution-row boundaries)
     * instead of one string — so large results cross the wasm boundary piecewise
     * and the caller can surface rows incrementally. The chunk sequence is
     * produced eagerly inside wasm (the engine's chunked serialiser, which never
     * concatenates a whole-result string); the streaming win is on the JS side,
     * which holds at most one chunk at a time.
     * @param {string} sparql
     * @returns {QueryChunks}
     */
    queryChunks(sparql) {
        const ptr0 = passStringToWasm0(sparql, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.store_queryChunks(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return QueryChunks.__wrap(ret[0]);
    }
    /**
     * Runs a SELECT (or ASK) query and returns a [`SolutionCursor`] that yields the
     * solutions in batches of at most `batchSize` rows, each batch a self-contained
     * SPARQL 1.1 JSON document the caller can `JSON.parse` on its own. This is the
     * row-oriented streaming entry point: pull a batch, surface/drop its rows, pull the
     * next — the consumer never holds more than one batch, so peak JS memory is bounded
     * by `batchSize` rather than by the whole result. (`queryChunks` streams the *bytes*
     * of one JSON string at fixed ~64 KiB cuts that must be re-joined before parsing;
     * `queryCursor` streams *parseable solution batches*.) `batchSize` is clamped to at
     * least 1. Caveat: the engine materialises the full result inside wasm before the
     * first batch — there is no lazy engine-level solution iterator at this layer — so the
     * bound is on the JS-side string copy, not on wasm working set.
     * @param {string} sparql
     * @param {number} batch_size
     * @returns {SolutionCursor}
     */
    queryCursor(sparql, batch_size) {
        const ptr0 = passStringToWasm0(sparql, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.store_queryCursor(this.__wbg_ptr, ptr0, len0, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return SolutionCursor.__wrap(ret[0]);
    }
    /**
     * Runs a **CONSTRUCT or DESCRIBE** query and returns the resulting RDF graph
     * serialised as **N-Triples** (one `s p o .` line per triple). N-Triples is a
     * syntactic subset of Turtle, so the returned string is also a valid `text/turtle`
     * document. This is the quad-returning entry point: where [`query`](Self::query)
     * answers SELECT/ASK with a solution table, `queryQuads` answers the graph-valued
     * query forms with their constructed graph. CONSTRUCT instantiates its template once
     * per WHERE solution (template blank nodes are freshened per solution, and triples
     * with unbound or RDF-illegal terms are dropped per SPARQL §16.2); DESCRIBE returns
     * the concise bounded description of each described resource. A SELECT/ASK query is
     * rejected here — use [`query`](Self::query) / [`queryChunks`](Self::query_chunks).
     * @param {string} sparql
     * @returns {string}
     */
    queryQuads(sparql) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(sparql, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.store_queryQuads(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Like [`queryQuads`](Self::query_quads) but returns a [`QuadChunks`] cursor that
     * yields the constructed graph in batches of at most `batchSize` triples (each an
     * N-Triples fragment), so a large constructed/described graph crosses the wasm
     * boundary piecewise and the caller holds at most one batch at a time. Concatenating
     * every batch reproduces `queryQuads`'s document exactly. `batchSize` is clamped to at
     * least 1. Caveat: as with [`queryQuads`](Self::query_quads) the full graph is
     * materialised inside wasm before the first batch; the bound is on the JS-side copy.
     * @param {string} sparql
     * @param {number} batch_size
     * @returns {QuadChunks}
     */
    queryQuadsChunks(sparql, batch_size) {
        const ptr0 = passStringToWasm0(sparql, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.store_queryQuadsChunks(this.__wbg_ptr, ptr0, len0, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return QuadChunks.__wrap(ret[0]);
    }
    /**
     * The number of (deduplicated) triples in the store.
     * @returns {number}
     */
    get size() {
        const ret = wasm.store_size(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Applies a SPARQL 1.1 Update (`INSERT DATA`, `DELETE DATA`, `CLEAR`,
     * `DELETE/INSERT … WHERE` on the default graph) and returns the **new** store —
     * the receiver is immutable and remains valid. Mirrors `sparq_engine::update`'s
     * rebuild semantics. Prefer [`updateInPlace`](Self::update_in_place), which is
     * O(batch) instead of O(store) for the data operations.
     * @param {string} sparql
     * @returns {Store}
     */
    update(sparql) {
        const ptr0 = passStringToWasm0(sparql, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.store_update(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Store.__wrap(ret[0]);
    }
    /**
     * Applies a SPARQL 1.1 Update IN PLACE through the store's delta overlay
     * (`sparq_engine::update_in_place`): data operations are O(batch) per target
     * graph — no index rebuild — and `GRAPH` blocks / graph templates / `CLEAR` /
     * `DROP` / `CREATE` address named graphs. The dictionary grows append-only,
     * so existing term ids stay valid.
     * @param {string} sparql
     */
    updateInPlace(sparql) {
        const ptr0 = passStringToWasm0(sparql, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.store_updateInPlace(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
}
if (Symbol.dispose) Store.prototype[Symbol.dispose] = Store.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_ef53bc310eb298a0: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_throw_1506f2235d1bdba0: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_getRandomValues_3f44b700395062e5: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./sparq_wasm_bg.js": import0,
    };
}

const QuadChunksFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_quadchunks_free(ptr, 1));
const QueryChunksFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_querychunks_free(ptr, 1));
const SolutionCursorFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_solutioncursor_free(ptr, 1));
const StoreFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_store_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('sparq_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
