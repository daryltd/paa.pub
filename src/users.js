/**
 * User management module for multi-user support.
 *
 * KV keys:
 *   - `users_index` — JSON array of { username, createdAt, isAdmin, disabled }
 *   - `user_meta:{username}` — { storageLimit, disabled, createdAt, isAdmin }
 *   - `user:{username}` — password hash (existing key format)
 */

/**
 * List all registered users.
 * @param {KVNamespace} kv
 * @returns {Promise<Array<{username: string, createdAt: string, isAdmin: boolean, disabled: boolean}>>}
 */
export async function listUsers(kv) {
  const data = await kv.get('users_index');
  return data ? JSON.parse(data) : [];
}

/**
 * Get metadata for a specific user.
 * @param {KVNamespace} kv
 * @param {string} username
 * @returns {Promise<object|null>}
 */
export async function getUser(kv, username) {
  const data = await kv.get(`user_meta:${username}`);
  return data ? JSON.parse(data) : null;
}

/**
 * Check if a user exists (has a password hash stored).
 * @param {KVNamespace} kv
 * @param {string} username
 * @returns {Promise<boolean>}
 */
export async function userExists(kv, username) {
  const data = await kv.get(`user:${username}`);
  return data !== null;
}

/**
 * Create a new user.
 * @param {KVNamespace} kv
 * @param {string} username
 * @param {string} passwordHash
 * @param {object} [opts]
 * @param {boolean} [opts.isAdmin]
 * @param {number} [opts.storageLimit]
 */
export async function createUser(kv, username, passwordHash, opts = {}) {
  const now = new Date().toISOString();

  // Store password hash
  await kv.put(`user:${username}`, passwordHash);

  // Store user metadata
  const meta = {
    createdAt: now,
    isAdmin: opts.isAdmin || false,
    disabled: false,
    ...(opts.storageLimit ? { storageLimit: opts.storageLimit } : {}),
  };
  await kv.put(`user_meta:${username}`, JSON.stringify(meta));

  // Update users index
  const index = await listUsers(kv);
  // Avoid duplicates
  if (!index.some(u => u.username === username)) {
    index.push({
      username,
      createdAt: now,
      isAdmin: meta.isAdmin,
      disabled: false,
    });
    await kv.put('users_index', JSON.stringify(index));
  }
}

/**
 * Disable a user account.
 * @param {KVNamespace} kv
 * @param {string} username
 */
export async function disableUser(kv, username) {
  const meta = await getUser(kv, username);
  if (meta) {
    meta.disabled = true;
    await kv.put(`user_meta:${username}`, JSON.stringify(meta));
  }

  // Update index
  const index = await listUsers(kv);
  const entry = index.find(u => u.username === username);
  if (entry) {
    entry.disabled = true;
    await kv.put('users_index', JSON.stringify(index));
  }
}

/**
 * Enable a user account.
 * @param {KVNamespace} kv
 * @param {string} username
 */
export async function enableUser(kv, username) {
  const meta = await getUser(kv, username);
  if (meta) {
    meta.disabled = false;
    await kv.put(`user_meta:${username}`, JSON.stringify(meta));
  }

  // Update index
  const index = await listUsers(kv);
  const entry = index.find(u => u.username === username);
  if (entry) {
    entry.disabled = false;
    await kv.put('users_index', JSON.stringify(index));
  }
}

/**
 * Set per-user storage limit.
 * @param {KVNamespace} kv
 * @param {string} username
 * @param {number} limitBytes
 */
export async function setUserQuota(kv, username, limitBytes) {
  const meta = await getUser(kv, username);
  if (meta) {
    meta.storageLimit = limitBytes;
    await kv.put(`user_meta:${username}`, JSON.stringify(meta));
  }
}

/**
 * Get the effective storage limit for a user.
 * Returns per-user limit if set, otherwise the default.
 * @param {KVNamespace} kv
 * @param {string} username
 * @param {number} defaultLimit
 * @returns {Promise<number>}
 */
export async function getUserStorageLimit(kv, username, defaultLimit) {
  const meta = await getUser(kv, username);
  if (meta && meta.storageLimit !== undefined && meta.storageLimit !== null) {
    return meta.storageLimit;
  }
  return defaultLimit;
}
