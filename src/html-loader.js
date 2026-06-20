/**
 * HTML template loader for Deno.
 *
 * Cloudflare Workers imports HTML via Wrangler's [[rules]] bundler.
 * Deno doesn't support `import x from './file.html'`.
 * This module reads HTML files from disk and caches them.
 */
const cache = new Map();

export function loadHtml(importMetaUrl, relativePath) {
  const key = `${importMetaUrl}:${relativePath}`;
  if (cache.has(key)) return cache.get(key);

  const url = new URL(relativePath, importMetaUrl);
  const content = Deno.readTextFileSync(url);
  cache.set(key, content);
  return content;
}
