/**
 * Remote actor fetch and cache.
 */
import { simpleHash } from '../utils.js';
import { validateExternalUrl } from '../security/ssrf.js';

const CACHE_TTL = 3600; // 1 hour

/**
 * Fetch a remote actor document, using cache.
 * @param {string} actorUri
 * @param {KVNamespace} kv - APPDATA
 * @returns {Promise<object|null>}
 */
export async function fetchRemoteActor(actorUri, kv) {
  if (!validateExternalUrl(actorUri)) {
    console.log(`[remote] SSRF blocked: ${actorUri}`);
    return null;
  }

  const cacheKey = `ap_remote_actor:${simpleHash(actorUri)}`;
  const cached = await kv.get(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    const response = await fetch(actorUri, {
      headers: {
        Accept: 'application/activity+json, application/ld+json',
        'User-Agent': 'paa.pub/1.0',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;

    const actor = await response.json();
    await kv.put(cacheKey, JSON.stringify(actor), { expirationTtl: CACHE_TTL });
    return actor;
  } catch {
    return null;
  }
}

/**
 * Get the inbox URL for a remote actor.
 * @param {object} actor
 * @returns {string|null}
 */
export function getActorInbox(actor) {
  return actor?.inbox || null;
}

/**
 * Get the shared inbox URL for a remote actor.
 * @param {object} actor
 * @returns {string|null}
 */
export function getActorSharedInbox(actor) {
  return actor?.endpoints?.sharedInbox || null;
}

/**
 * Get the public key PEM from a remote actor document.
 * @param {object} actor
 * @returns {string|null}
 */
export function getActorPublicKey(actor) {
  return actor?.publicKey?.publicKeyPem || null;
}

/**
 * Resolve a handle (user@domain) to an actor URI via WebFinger.
 * @param {string} handle
 * @returns {Promise<string|null>}
 */
export async function resolveHandle(handle) {
  // Strip leading @ if present (@user@domain → user@domain)
  const normalized = (handle.startsWith('@') ? handle.slice(1) : handle).trim();
  const parts = normalized.split('@');
  const user = parts[0];
  const domain = parts.slice(1).join('@');
  console.log(`[webfinger] resolveHandle: raw="${handle}" normalized="${normalized}" user="${user}" domain="${domain}"`);
  if (!user || !domain) return null;

  const url = `https://${domain}/.well-known/webfinger?resource=acct:${encodeURIComponent(normalized)}`;
  if (!validateExternalUrl(url)) {
    console.log(`[remote] SSRF blocked webfinger: ${url}`);
    return null;
  }

  try {
    console.log(`[webfinger] Fetching: ${url}`);
    const response = await fetch(url, {
      headers: { Accept: 'application/jrd+json' },
      signal: AbortSignal.timeout(10000),
    });
    console.log(`[webfinger] Response: ${response.status}`);
    if (!response.ok) return null;

    const jrd = await response.json();
    console.log(`[webfinger] Links: ${JSON.stringify(jrd.links)}`);
    const selfLink = jrd.links?.find(l => l.rel === 'self' && l.type === 'application/activity+json');
    console.log(`[webfinger] selfLink: ${JSON.stringify(selfLink)}`);
    return selfLink?.href || null;
  } catch (e) {
    console.error(`[webfinger] Error: ${e.message}`);
    return null;
  }
}

