/**
 * Per-container storage quota tracking.
 *
 * Storage key: `container_quota:{containerIri}` in APPDATA
 * Value: `{ limitBytes?: number, usedBytes: number }`
 *
 * Quotas are hierarchical — a write must satisfy the quota of every
 * ancestor container that has a limit set. The most restrictive wins.
 */
import { parentContainer } from '../solid/containers.js';

/**
 * Check whether a write would exceed any container quota in the hierarchy.
 * Walks from the immediate container up to the root, checking each ancestor.
 * @param {KVNamespace} kv - APPDATA
 * @param {string} containerIri - The container the resource belongs to
 * @param {number} bytes - Size of the incoming write
 * @returns {Promise<{allowed: boolean, blockedBy?: string, usedBytes?: number, limitBytes?: number}>}
 */
export async function checkContainerQuota(kv, containerIri, bytes) {
  let current = containerIri;
  while (current) {
    const data = await kv.get(`container_quota:${current}`);
    if (data) {
      const quota = JSON.parse(data);
      if (quota.limitBytes !== undefined && quota.limitBytes !== null) {
        if ((quota.usedBytes || 0) + bytes > quota.limitBytes) {
          return {
            allowed: false,
            blockedBy: current,
            usedBytes: quota.usedBytes || 0,
            limitBytes: quota.limitBytes,
          };
        }
      }
    }
    current = parentContainer(current);
  }
  return { allowed: true };
}

/**
 * Increment the used bytes for a container and all its ancestors.
 * @param {KVNamespace} kv - APPDATA
 * @param {string} containerIri
 * @param {number} bytes
 */
export async function addContainerBytes(kv, containerIri, bytes) {
  let current = containerIri;
  while (current) {
    const data = await kv.get(`container_quota:${current}`);
    const quota = data ? JSON.parse(data) : { usedBytes: 0 };
    quota.usedBytes = (quota.usedBytes || 0) + bytes;
    await kv.put(`container_quota:${current}`, JSON.stringify(quota));
    current = parentContainer(current);
  }
}

/**
 * Decrement the used bytes for a container and all its ancestors.
 * @param {KVNamespace} kv - APPDATA
 * @param {string} containerIri
 * @param {number} bytes
 */
export async function subtractContainerBytes(kv, containerIri, bytes) {
  let current = containerIri;
  while (current) {
    const data = await kv.get(`container_quota:${current}`);
    if (data) {
      const quota = JSON.parse(data);
      quota.usedBytes = Math.max(0, (quota.usedBytes || 0) - bytes);
      await kv.put(`container_quota:${current}`, JSON.stringify(quota));
    }
    current = parentContainer(current);
  }
}

/**
 * Set or remove the quota limit for a container.
 * @param {KVNamespace} kv - APPDATA
 * @param {string} containerIri
 * @param {number|null} limitBytes - Limit in bytes, or null to remove
 */
export async function setContainerQuotaLimit(kv, containerIri, limitBytes) {
  const data = await kv.get(`container_quota:${containerIri}`);
  const quota = data ? JSON.parse(data) : { usedBytes: 0 };
  if (limitBytes === null || limitBytes === undefined) {
    delete quota.limitBytes;
  } else {
    quota.limitBytes = limitBytes;
  }
  await kv.put(`container_quota:${containerIri}`, JSON.stringify(quota));
}

/**
 * Get the quota data for a container.
 * @param {KVNamespace} kv - APPDATA
 * @param {string} containerIri
 * @returns {Promise<{usedBytes: number, limitBytes?: number}|null>}
 */
export async function getContainerQuota(kv, containerIri) {
  const data = await kv.get(`container_quota:${containerIri}`);
  return data ? JSON.parse(data) : null;
}

/**
 * Build a 507 response naming the container that blocked the write.
 * @param {string} containerIri
 * @param {number} usedBytes
 * @param {number} limitBytes
 * @returns {Response}
 */
export function containerQuotaExceededResponse(containerIri, usedBytes, limitBytes) {
  return new Response(JSON.stringify({
    error: 'insufficient_storage',
    message: `Container quota exceeded for ${containerIri}`,
    container: containerIri,
    usedBytes,
    limitBytes,
  }), {
    status: 507,
    headers: { 'Content-Type': 'application/json' },
  });
}
