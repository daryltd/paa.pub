/**
 * Configuration for OpenShift/Deno deployment.
 * Reads from Deno.env instead of Cloudflare Worker bindings.
 * Same config shape as config.js — all handlers work unchanged.
 */
import { RESERVED_NAMES } from './config.js';

export { RESERVED_NAMES };
export { getUserConfig } from './config.js';

/**
 * Read configuration from Deno environment variables.
 * @param {Request} [request] - incoming request (used to auto-detect domain)
 * @returns {object} config
 */
export function getConfig(_env, request) {
  const adminUsername = Deno.env.get('PAA_USERNAME') || 'admin';

  if (RESERVED_NAMES.has(adminUsername)) {
    throw new Error(`Username "${adminUsername}" is reserved. Choose a different PAA_USERNAME.`);
  }
  const adminPassword = Deno.env.get('PAA_PASSWORD') || '';

  let domain = Deno.env.get('PAA_DOMAIN') || '';
  let protocol;
  if (!domain && request) {
    const url = new URL(request.url);
    domain = url.host;
    protocol = url.protocol.replace(':', '');
  } else {
    domain = domain || 'localhost:3000';
    protocol = domain.startsWith('localhost') ? 'http' : 'https';
  }
  const baseUrl = `${protocol}://${domain}`;

  const storageLimit = parseStorageLimit(Deno.env.get('PAA_STORAGE_LIMIT'));
  const feedLimit = parseInt(Deno.env.get('PAA_FEED_LIMIT') || '50', 10) || 50;
  const registrationMode = Deno.env.get('PAA_REGISTRATION') || 'open';

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

function parseStorageLimit(value) {
  const DEFAULT = 1024 * 1024 * 1024;
  if (!value) return DEFAULT;
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(GB|MB|KB|B)?$/i);
  if (!match) return DEFAULT;
  const num = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();
  const multipliers = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
  return Math.floor(num * (multipliers[unit] || 1));
}
