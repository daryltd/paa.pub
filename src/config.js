const RESERVED_NAMES = new Set([
  'css', 'scripts', 'media',
  'login', 'logout', 'dashboard', 'activity', 'storage', 'acp',
  'profile', 'compose', 'follow', 'unfollow',
  'authorize', 'token', 'register', 'userinfo', 'jwks',
  'webauthn', 'app-permissions', 'follow-requests',
  '.well-known',
  'signup', 'admin', 'fedcm', 'settings',
]);

export { RESERVED_NAMES };

/**
 * Read configuration from Cloudflare Worker environment bindings.
 * Returns global server config (not user-specific).
 * @param {object} env - Cloudflare Worker env object
 * @param {Request} [request] - incoming request (used to auto-detect domain)
 * @returns {object} config
 */
export function getConfig(env, request) {
  const adminUsername = env.PAA_USERNAME || 'admin';

  if (RESERVED_NAMES.has(adminUsername)) {
    throw new Error(`Username "${adminUsername}" is reserved (conflicts with system route). Choose a different PAA_USERNAME.`);
  }
  const adminPassword = env.PAA_PASSWORD || '';

  let domain = env.PAA_DOMAIN || '';
  let protocol;
  if (!domain && request) {
    const url = new URL(request.url);
    domain = url.host;
    protocol = url.protocol.replace(':', '');
  } else {
    domain = domain || 'localhost:8787';
    protocol = domain.startsWith('localhost') ? 'http' : 'https';
  }
  const baseUrl = `${protocol}://${domain}`;

  // Storage limit: parse PAA_STORAGE_LIMIT (e.g. "1GB", "500MB"), default 1 GB
  const storageLimit = parseStorageLimit(env.PAA_STORAGE_LIMIT);

  // Feed limit: max activities shown in the feed (default 50)
  const feedLimit = parseInt(env.PAA_FEED_LIMIT, 10) || 50;

  // Registration mode: "open" (default) or "closed"
  const registrationMode = env.PAA_REGISTRATION || 'open';

  return {
    adminUsername,
    username: adminUsername,
    adminPassword,
    domain,
    baseUrl,
    protocol,
    storageLimit,
    feedLimit,
    registrationMode,
  };
}

/**
 * Build user-specific config fields from global config + username.
 * @param {object} config - global config from getConfig()
 * @param {string} username
 * @returns {object} user-specific config
 */
export function getUserConfig(config, username) {
  // did:web spec: port colons in domain become %3A
  const encodedDomain = config.domain.replace(/:/g, '%3A');
  return {
    username,
    webId: `${config.baseUrl}/${username}/profile/card#me`,
    actorId: `${config.baseUrl}/${username}/profile/card#me`,
    keyId: `${config.baseUrl}/${username}/profile/card#main-key`,
    did: `did:web:${encodedDomain}:${username}`,
  };
}

/**
 * Parse a storage limit string (e.g. "1GB", "500MB", "2048") to bytes.
 * @param {string|undefined} value
 * @returns {number} Limit in bytes (default 1 GB)
 */
function parseStorageLimit(value) {
  const DEFAULT = 1024 * 1024 * 1024; // 1 GB
  if (!value) return DEFAULT;

  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(GB|MB|KB|B)?$/i);
  if (!match) return DEFAULT;

  const num = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();
  const multipliers = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
  return Math.floor(num * (multipliers[unit] || 1));
}
