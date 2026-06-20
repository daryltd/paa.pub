/**
 * OpenShift storage adapter — sparq in-memory Store for all data,
 * MinIO for blobs, periodic N-Quads snapshots for durability.
 *
 * Same interface as CloudflareAdapter: get/put/delete/getBlob/putBlob/deleteBlob/list
 * so all handler code works unchanged.
 */
import { Store } from '../rdf/sparq.js';

const PAA_VALUE = 'urn:paa:value';
const PAA_EXPIRES = 'urn:paa:expiresAt';
const PAA_KV_GRAPH = 'urn:paa:kv:';

export class OpenShiftAdapter {
  constructor(minioClient, minioBucket, snapshotPath) {
    this.minio = minioClient;
    this.bucket = minioBucket;
    this.snapshotPath = snapshotPath || 'paa-snapshot.nq';
    this.store = Store.load('', 'ntriples');
    this._dirty = false;
    this._snapshotTimer = null;
    this._snapshotInterval = parseInt(Deno.env.get('PAA_SNAPSHOT_INTERVAL') || '30000', 10);
  }

  async init() {
    try {
      const data = await this._getFromMinio(this.snapshotPath);
      if (data) {
        this.store = Store.load(data, 'ntriples');
        console.log('[storage] Loaded snapshot from MinIO');
      }
    } catch (e) {
      console.log('[storage] No existing snapshot, starting fresh');
    }
    this._startSnapshotTimer();
    this._startExpirationSweep();
  }

  // --- KV-compatible interface (text data) ---

  async get(key) {
    const subj = PAA_KV_GRAPH + encodeURIComponent(key);
    const sparql = `SELECT ?v WHERE { <${subj}> <${PAA_VALUE}> ?v }`;
    const jsonStr = this.store.query(sparql);
    const results = JSON.parse(jsonStr);
    if (!results.results?.bindings?.length) return null;
    return results.results.bindings[0].v.value;
  }

  async put(key, value, opts = {}) {
    const subj = PAA_KV_GRAPH + encodeURIComponent(key);
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

    // Clear existing
    try { this.store.updateInPlace(`DELETE WHERE { <${subj}> ?p ?o }`); } catch (_) {}

    let insertData = `<${subj}> <${PAA_VALUE}> "${escaped}" .`;
    if (opts.expirationTtl) {
      const expiresAt = new Date(Date.now() + opts.expirationTtl * 1000).toISOString();
      insertData += `\n<${subj}> <${PAA_EXPIRES}> "${expiresAt}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`;
    }

    this.store.updateInPlace(`INSERT DATA { ${insertData} }`);
    this._dirty = true;
  }

  async delete(key) {
    const subj = PAA_KV_GRAPH + encodeURIComponent(key);
    try { this.store.updateInPlace(`DELETE WHERE { <${subj}> ?p ?o }`); } catch (_) {}
    this._dirty = true;
  }

  async list(opts = {}) {
    const prefix = opts.prefix || '';
    const limit = opts.limit || 1000;
    const encodedPrefix = PAA_KV_GRAPH + encodeURIComponent(prefix);

    const sparql = `SELECT DISTINCT ?s WHERE { ?s <${PAA_VALUE}> ?v FILTER(STRSTARTS(STR(?s), "${encodedPrefix}")) } LIMIT ${limit}`;
    const jsonStr = this.store.query(sparql);
    const results = JSON.parse(jsonStr);

    const keys = (results.results?.bindings || []).map(b => {
      const raw = b.s.value.slice(PAA_KV_GRAPH.length);
      return { name: decodeURIComponent(raw) };
    });

    return { keys, list_complete: keys.length < limit, cursor: null };
  }

  // --- Blob interface (MinIO) ---

  async getBlob(key) {
    return this._getFromMinioBinary(key);
  }

  async getBlobWithMeta(key) {
    try {
      const stream = await this.minio.getObject(this.bucket, key);
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const buffer = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }
      const stat = await this.minio.statObject(this.bucket, key);
      return {
        data: buffer.buffer,
        contentType: stat.metaData?.['content-type'] || 'application/octet-stream',
      };
    } catch (e) {
      if (e.code === 'NoSuchKey' || e.code === 'NotFound') return null;
      throw e;
    }
  }

  async putBlob(key, data, contentType) {
    const buffer = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    await this.minio.putObject(this.bucket, key, buffer, buffer.length, {
      'Content-Type': contentType,
    });
  }

  async deleteBlob(key) {
    try {
      await this.minio.removeObject(this.bucket, key);
    } catch (_) {}
  }

  // --- Snapshot persistence ---

  async snapshot() {
    if (!this._dirty) return;
    try {
      const allData = this._exportAsNTriples();
      await this._putToMinio(this.snapshotPath, allData);
      this._dirty = false;
      console.log('[storage] Snapshot saved to MinIO');
    } catch (e) {
      console.error('[storage] Snapshot failed:', e);
    }
  }

  _exportAsNTriples() {
    try {
      const result = this.store.query('SELECT ?s ?p ?o WHERE { ?s ?p ?o }');
      const bindings = JSON.parse(result);
      let nt = '';
      for (const b of bindings.results?.bindings || []) {
        nt += `${formatTerm(b.s)} ${formatTerm(b.p)} ${formatTerm(b.o)} .\n`;
      }
      return nt;
    } catch (e) {
      console.error('[storage] Export error:', e);
      return '';
    }
  }

  _exportAllGraphs() {
    try {
      const result = this.store.query('SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }');
      const graphs = JSON.parse(result);
      let nquads = '';

      // Default graph
      const defaultResult = this.store.query('SELECT ?s ?p ?o WHERE { ?s ?p ?o }');
      const defaultBindings = JSON.parse(defaultResult);
      for (const b of defaultBindings.results?.bindings || []) {
        nquads += `${formatTerm(b.s)} ${formatTerm(b.p)} ${formatTerm(b.o)} .\n`;
      }

      // Named graphs
      for (const b of graphs.results?.bindings || []) {
        const g = b.g.value;
        const gResult = this.store.query(`SELECT ?s ?p ?o WHERE { GRAPH <${g}> { ?s ?p ?o } }`);
        const gBindings = JSON.parse(gResult);
        for (const gb of gBindings.results?.bindings || []) {
          nquads += `${formatTerm(gb.s)} ${formatTerm(gb.p)} ${formatTerm(gb.o)} <${g}> .\n`;
        }
      }

      return nquads;
    } catch (e) {
      console.error('[storage] Export error:', e);
      return '';
    }
  }

  _startSnapshotTimer() {
    this._snapshotTimer = setInterval(() => this.snapshot(), this._snapshotInterval);
  }

  _startExpirationSweep() {
    setInterval(() => {
      try {
        const now = new Date().toISOString();
        this.store.updateInPlace(`
          DELETE { ?s ?p ?o }
          WHERE {
            ?s <${PAA_EXPIRES}> ?exp .
            ?s ?p ?o .
            FILTER(?exp < "${now}"^^<http://www.w3.org/2001/XMLSchema#dateTime>)
          }
        `);
      } catch (_) {}
    }, 60000);
  }

  async shutdown() {
    if (this._snapshotTimer) clearInterval(this._snapshotTimer);
    await this.snapshot();
  }

  // --- MinIO helpers ---

  async _getFromMinio(key) {
    try {
      const stream = await this.minio.getObject(this.bucket, key);
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(new TextDecoder().decode(chunk));
      }
      return chunks.join('');
    } catch (e) {
      if (e.code === 'NoSuchKey' || e.code === 'NotFound') return null;
      throw e;
    }
  }

  async _getFromMinioBinary(key) {
    try {
      const stream = await this.minio.getObject(this.bucket, key);
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const total = chunks.reduce((a, c) => a + c.length, 0);
      const buffer = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }
      return buffer.buffer;
    } catch (e) {
      if (e.code === 'NoSuchKey' || e.code === 'NotFound') return null;
      throw e;
    }
  }

  async _putToMinio(key, data) {
    const encoded = new TextEncoder().encode(data);
    await this.minio.putObject(this.bucket, key, encoded, encoded.length, {
      'Content-Type': 'application/n-quads',
    });
  }
}

function formatTerm(term) {
  if (!term) return '""';
  switch (term.type) {
    case 'uri': return `<${term.value}>`;
    case 'bnode': return `_:${term.value}`;
    case 'literal': {
      const escaped = term.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
      if (term['xml:lang']) return `"${escaped}"@${term['xml:lang']}`;
      if (term.datatype && term.datatype !== 'http://www.w3.org/2001/XMLSchema#string') {
        return `"${escaped}"^^<${term.datatype}>`;
      }
      return `"${escaped}"`;
    }
    default: return `"${term.value}"`;
  }
}
