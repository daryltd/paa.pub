/**
 * Dual-runtime static text asset loader (HTML templates, Turtle strings).
 *
 * Cloudflare Workers: Wrangler's [[rules]] bundler needs a literal,
 * statically-discoverable `import('./file.html')` in the caller's own
 * source to bundle the file — a generic helper can't do that dynamic
 * import itself with a runtime-computed path, so callers pass a thunk
 * that performs their own import.
 *
 * Deno: any `.html`/`.ttl` import (static OR dynamic) makes Deno's module
 * resolver throw as soon as that import is actually evaluated — even
 * inside an unreached branch is fine, but the thunk must never be called.
 * So on Deno we read the file from disk instead and never invoke the
 * caller's thunk at all.
 */
const cache = new Map();

export async function loadHtml(importMetaUrl, relativePath, dynamicImport) {
  const key = `${importMetaUrl}:${relativePath}`;
  if (cache.has(key)) return cache.get(key);

  let content;
  if (typeof Deno !== 'undefined') {
    content = Deno.readTextFileSync(new URL(relativePath, importMetaUrl));
  } else {
    const mod = await dynamicImport();
    content = mod.default;
  }
  cache.set(key, content);
  return content;
}
