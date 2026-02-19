/**
 * Remote actor fetch and cache.
 */

const CACHE_TTL = 3600; // 1 hour

/**
 * Fetch a remote actor document, using cache.
 * @param {string} actorUri
 * @param {KVNamespace} kv - APPDATA
 * @returns {Promise<object|null>}
 */
export async function fetchRemoteActor(actorUri, kv) {
  const cacheKey = `ap_remote_actor:${hashStr(actorUri)}`;
  const cached = await kv.get(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    const response = await fetch(actorUri, {
      headers: {
        Accept: 'application/activity+json, application/ld+json',
        'User-Agent': 'paa.pub/1.0',
      },
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
  const [user, domain] = handle.split('@');
  if (!user || !domain) return null;

  try {
    const url = `https://${domain}/.well-known/webfinger?resource=acct:${encodeURIComponent(handle)}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/jrd+json' },
    });
    if (!response.ok) return null;

    const jrd = await response.json();
    const selfLink = jrd.links?.find(l => l.rel === 'self' && l.type === 'application/activity+json');
    return selfLink?.href || null;
  } catch {
    return null;
  }
}

function hashStr(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
