/**
 * Read configuration from Cloudflare Worker environment bindings.
 * @param {object} env - Cloudflare Worker env object
 * @param {Request} [request] - incoming request (used to auto-detect domain)
 * @returns {object} config
 */
export function getConfig(env, request) {
  const username = env.PAA_USERNAME || 'admin';
  const password = env.PAA_PASSWORD || '';

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

  return {
    username,
    password,
    domain,
    baseUrl,
    protocol,
    storageLimit,
    feedLimit,
    actorId: `${baseUrl}/${username}/profile/card#me`,
    keyId: `${baseUrl}/${username}/profile/card#main-key`,
    webId: `${baseUrl}/${username}/profile/card#me`,
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
