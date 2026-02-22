/**
 * App write permission enforcement for OIDC-authenticated apps.
 *
 * OIDC-authenticated apps are restricted to writing only within containers
 * the owner has explicitly approved. Session-authenticated owner always
 * has unrestricted access.
 *
 * Storage (APPDATA KV):
 *   app_perm:{username}:{hash(clientId)} → { clientId, clientName, allowedContainers: string[], grantedAt }
 *   app_perms_index:{username} → [{ clientId, clientName, hash }]
 */
import { simpleHash } from '../utils.js';

/**
 * Check if an OIDC app has write permission for a resource.
 * Uses prefix matching: if `/alice/public/` is allowed, writes to
 * `/alice/public/photos/cat.jpg` are also allowed.
 *
 * @param {KVNamespace} kv - APPDATA
 * @param {string} username
 * @param {string} clientId - OIDC client_id
 * @param {string} resourceIri - Full resource IRI being written to
 * @returns {Promise<boolean>}
 */
export async function checkAppWritePermission(kv, username, clientId, resourceIri) {
  const hash = simpleHash(clientId);
  const data = await kv.get(`app_perm:${username}:${hash}`);
  if (!data) return false;

  const perm = JSON.parse(data);
  // Verify clientId matches (hash collision guard)
  if (perm.clientId !== clientId) return false;

  const containers = perm.allowedContainers || [];
  return containers.some(containerIri => resourceIri.startsWith(containerIri));
}

/**
 * Grant an app permission to write to specific containers.
 * @param {KVNamespace} kv - APPDATA
 * @param {string} username
 * @param {string} clientId
 * @param {string} clientName
 * @param {string[]} allowedContainers - Container IRIs
 */
export async function grantAppPermission(kv, username, clientId, clientName, allowedContainers) {
  const hash = simpleHash(clientId);
  const perm = {
    clientId,
    clientName: clientName || '',
    allowedContainers,
    grantedAt: new Date().toISOString(),
  };
  await kv.put(`app_perm:${username}:${hash}`, JSON.stringify(perm));

  // Update index
  const indexData = await kv.get(`app_perms_index:${username}`);
  const index = indexData ? JSON.parse(indexData) : [];
  const existing = index.findIndex(e => e.hash === hash);
  if (existing >= 0) {
    index[existing] = { clientId, clientName: clientName || '', hash };
  } else {
    index.push({ clientId, clientName: clientName || '', hash });
  }
  await kv.put(`app_perms_index:${username}`, JSON.stringify(index));
}

/**
 * Revoke all permissions for an app.
 * @param {KVNamespace} kv - APPDATA
 * @param {string} username
 * @param {string} clientId
 */
export async function revokeAppPermission(kv, username, clientId) {
  const hash = simpleHash(clientId);
  await kv.delete(`app_perm:${username}:${hash}`);

  // Update index
  const indexData = await kv.get(`app_perms_index:${username}`);
  if (indexData) {
    const index = JSON.parse(indexData);
    const filtered = index.filter(e => e.hash !== hash);
    await kv.put(`app_perms_index:${username}`, JSON.stringify(filtered));
  }

  // Also remove from trusted clients
  const trustedData = await kv.get(`oidc_trusted_clients:${username}`);
  if (trustedData) {
    const trusted = JSON.parse(trustedData);
    const filtered = trusted.filter(c => c !== clientId);
    await kv.put(`oidc_trusted_clients:${username}`, JSON.stringify(filtered));
  }
}

/**
 * Get all app permissions for a user.
 * @param {KVNamespace} kv - APPDATA
 * @param {string} username
 * @returns {Promise<Array<{clientId: string, clientName: string, allowedContainers: string[], grantedAt: string}>>}
 */
export async function listAppPermissions(kv, username) {
  const indexData = await kv.get(`app_perms_index:${username}`);
  if (!indexData) return [];

  const index = JSON.parse(indexData);
  const perms = [];
  for (const entry of index) {
    const data = await kv.get(`app_perm:${username}:${entry.hash}`);
    if (data) {
      perms.push(JSON.parse(data));
    }
  }
  return perms;
}

/**
 * Get permission for a specific app.
 * @param {KVNamespace} kv - APPDATA
 * @param {string} username
 * @param {string} clientId
 * @returns {Promise<{clientId: string, clientName: string, allowedContainers: string[], grantedAt: string}|null>}
 */
export async function getAppPermission(kv, username, clientId) {
  const hash = simpleHash(clientId);
  const data = await kv.get(`app_perm:${username}:${hash}`);
  if (!data) return null;
  const perm = JSON.parse(data);
  if (perm.clientId !== clientId) return null;
  return perm;
}

/**
 * Check if an app has stored permissions (i.e. has been through the consent flow
 * with container selection).
 * @param {KVNamespace} kv - APPDATA
 * @param {string} username
 * @param {string} clientId
 * @returns {Promise<boolean>}
 */
export async function hasAppPermissions(kv, username, clientId) {
  const hash = simpleHash(clientId);
  const data = await kv.get(`app_perm:${username}:${hash}`);
  return data !== null;
}
