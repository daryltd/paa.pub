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
 * Check whether an incoming write would exceed the storage limit.
 * @param {KVNamespace} kv
 * @param {string} username
 * @param {number} incomingBytes - Size of the incoming write
 * @param {number} limit - Storage limit in bytes
 * @returns {Promise<{allowed: boolean, usedBytes: number, limitBytes: number}>}
 */
export async function checkQuota(kv, username, incomingBytes, limit) {
  const quota = await getQuota(kv, username);
  const allowed = (quota.usedBytes + incomingBytes) <= limit;
  return { allowed, usedBytes: quota.usedBytes, limitBytes: limit };
}

/**
 * Build a 507 Insufficient Storage response.
 * @param {number} usedBytes
 * @param {number} limitBytes
 * @returns {Response}
 */
export function quotaExceededResponse(usedBytes, limitBytes) {
  return new Response(JSON.stringify({
    error: 'insufficient_storage',
    message: 'Storage quota exceeded.',
    usedBytes,
    limitBytes,
  }), {
    status: 507,
    headers: { 'Content-Type': 'application/json' },
  });
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
