/**
 * Cloudflare Workers storage adapter using KV (text) and R2 (blobs).
 * Drop-in replacement for @s20e/adapters/cloudflare.
 */
export class CloudflareAdapter {
  constructor(kv, r2) {
    this.kv = kv;
    this.r2 = r2;
  }

  async get(key) {
    return this.kv.get(key, 'text');
  }

  async put(key, value) {
    await this.kv.put(key, value);
  }

  async delete(key) {
    await this.kv.delete(key);
  }

  async list(opts = {}) {
    return this.kv.list(opts);
  }

  async getBlob(key) {
    if (!this.r2) return null;
    const obj = await this.r2.get(key);
    return obj ? await obj.arrayBuffer() : null;
  }

  async getBlobWithMeta(key) {
    if (!this.r2) return null;
    const obj = await this.r2.get(key);
    if (!obj) return null;
    return {
      data: await obj.arrayBuffer(),
      contentType: obj.httpMetadata?.contentType || 'application/octet-stream',
    };
  }

  async putBlob(key, data, contentType) {
    if (!this.r2) throw new Error('R2 bucket not configured');
    await this.r2.put(key, data, {
      httpMetadata: { contentType },
    });
  }

  async deleteBlob(key) {
    if (!this.r2) throw new Error('R2 bucket not configured');
    await this.r2.delete(key);
  }
}
