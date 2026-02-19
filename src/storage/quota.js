/**
 * Storage quota tracking via APPDATA KV.
 */

/**
 * Get current quota usage.
 * @param {KVNamespace} kv
 * @param {string} username
 * @returns {Promise<{usedBytes: number}>}
 */
export async function getQuota(kv, username) {
  const data = await kv.get(`quota:${username}`);
  return data ? JSON.parse(data) : { usedBytes: 0 };
}

/**
 * Add bytes to quota.
 * @param {KVNamespace} kv
 * @param {string} username
 * @param {number} bytes
 */
export async function addQuota(kv, username, bytes) {
  const quota = await getQuota(kv, username);
  quota.usedBytes += bytes;
  await kv.put(`quota:${username}`, JSON.stringify(quota));
}

/**
 * Subtract bytes from quota.
 * @param {KVNamespace} kv
 * @param {string} username
 * @param {number} bytes
 */
export async function subtractQuota(kv, username, bytes) {
  const quota = await getQuota(kv, username);
  quota.usedBytes = Math.max(0, quota.usedBytes - bytes);
  await kv.put(`quota:${username}`, JSON.stringify(quota));
}
