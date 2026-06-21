/**
 * App permission enforcement for OIDC-authenticated apps.
 *
 * OIDC-authenticated apps are restricted to accessing only containers
 * the owner has explicitly approved. Session-authenticated owner always
 * has unrestricted access.
 *
 * Storage (APPDATA KV):
 *   app_perm:{username}:{hash(clientId)} → { clientId, clientName, allowedContainers, grantedAt }
 *   app_perms_index:{username} → [{ clientId, clientName, hash }]
 *
 * allowedContainers format:
 *   Array of { iri: string, modes: string[] }
 *   Modes: "Read", "Write", "Append", "Create", "Update", "Delete"
 *   "Write" implies Append, Create, Update, and Delete.
 *   Legacy format (plain string[]) is treated as all modes granted.
 */
import { simpleHash } from '../utils.js';

/** All access modes supported by the advanced permission UI. */
export const ACCESS_MODES = ['Read', 'Write', 'Append', 'Create', 'Update', 'Delete'];

/** Write sub-modes implied when "Write" is granted. */
const WRITE_IMPLIED = new Set(['Append', 'Create', 'Update', 'Delete']);

/**
 * Normalize an allowedContainers entry from storage.
 * Legacy entries are plain IRI strings; new entries are {iri, modes} objects.
 */
function normalizeEntry(entry) {
  if (typeof entry === 'string') {
    return { iri: entry, modes: [...ACCESS_MODES] };
  }
  return entry;
}

/**
 * Check if an OIDC app has permission to access a resource with a given mode.
 * Uses prefix matching: if `/alice/public/` is allowed, access to
 * `/alice/public/photos/cat.jpg` is also allowed.
 *
 * @param {KVNamespace} kv - APPDATA
 * @param {string} username
 * @param {string} clientId - OIDC client_id
 * @param {string} resourceIri - Full resource IRI being accessed
 * @param {string} [mode='Write'] - Access mode: Read, Write, Append, Create, Update, Delete
 * @returns {Promise<boolean>}
 */
export async function checkAppPermission(kv, username, clientId, resourceIri, mode = 'Write') {
  const hash = simpleHash(clientId);
  const data = await kv.get(`app_perm:${username}:${hash}`);
  if (!data) return false;

  const perm = JSON.parse(data);
  if (perm.clientId !== clientId) return false;

  const containers = (perm.allowedContainers || []).map(normalizeEntry);
  return containers.some(entry => {
    const iriMatch = resourceIri.startsWith(entry.iri);
    if (!iriMatch) return false;
    const modes = new Set(entry.modes);
    if (modes.has(mode)) return true;
    // "Write" implies all write sub-modes
    if (WRITE_IMPLIED.has(mode) && modes.has('Write')) return true;
    return false;
  });
}

/**
 * Grant an app permission to access specific containers.
 * @param {KVNamespace} kv - APPDATA
 * @param {string} username
 * @param {string} clientId
 * @param {string} clientName
 * @param {string} clientUri - Homepage URL of the app (optional)
 * @param {Array<{iri: string, modes: string[]}>} allowedContainers - Container entries with modes
 */
export async function grantAppPermission(kv, username, clientId, clientName, clientUri, allowedContainers) {
  const hash = simpleHash(clientId);
  const perm = {
    clientId,
    clientName: clientName || '',
    clientUri: clientUri || '',
    allowedContainers,
    grantedAt: new Date().toISOString(),
  };
  await kv.put(`app_perm:${username}:${hash}`, JSON.stringify(perm));

  // Update index
  const indexData = await kv.get(`app_perms_index:${username}`);
  const index = indexData ? JSON.parse(indexData) : [];
  const existing = index.findIndex(e => e.hash === hash);
  if (existing >= 0) {
    index[existing] = { clientId, clientName: clientName || '', clientUri: clientUri || '', hash };
  } else {
    index.push({ clientId, clientName: clientName || '', clientUri: clientUri || '', hash });
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
 * Normalizes legacy string[] containers to {iri, modes} format.
 * @param {KVNamespace} kv - APPDATA
 * @param {string} username
 * @returns {Promise<Array<{clientId: string, clientName: string, allowedContainers: Array<{iri: string, modes: string[]}>, grantedAt: string}>>}
 */
export async function listAppPermissions(kv, username) {
  const indexData = await kv.get(`app_perms_index:${username}`);
  if (!indexData) return [];

  const index = JSON.parse(indexData);
  const perms = [];
  for (const entry of index) {
    const data = await kv.get(`app_perm:${username}:${entry.hash}`);
    if (data) {
      const perm = JSON.parse(data);
      perm.allowedContainers = (perm.allowedContainers || []).map(normalizeEntry);
      perms.push(perm);
    }
  }
  return perms;
}

/**
 * Get permission for a specific app.
 * Normalizes legacy string[] containers to {iri, modes} format.
 * @param {KVNamespace} kv - APPDATA
 * @param {string} username
 * @param {string} clientId
 * @returns {Promise<{clientId: string, clientName: string, allowedContainers: Array<{iri: string, modes: string[]}>, grantedAt: string}|null>}
 */
export async function getAppPermission(kv, username, clientId) {
  const hash = simpleHash(clientId);
  const data = await kv.get(`app_perm:${username}:${hash}`);
  if (!data) return null;
  const perm = JSON.parse(data);
  if (perm.clientId !== clientId) return null;
  perm.allowedContainers = (perm.allowedContainers || []).map(normalizeEntry);
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
