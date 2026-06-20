/**
 * Activity delivery via ctx.waitUntil().
 */
import { signRequest } from './httpsig.js';
import { fetchRemoteActor, getActorInbox, getActorSharedInbox } from './remote.js';
import { validateExternalUrl } from '../security/ssrf.js';

/**
 * Deliver an activity to a list of inbox URLs.
 * @param {object} opts
 * @param {string} opts.activityJson - JSON string of the activity
 * @param {string[]} opts.inboxUrls - Target inbox URLs
 * @param {string} opts.keyId - Key ID for HTTP Signatures
 * @param {string} opts.privatePem - Private key PEM
 * @param {object} opts.ctx - Execution context (waitUntil)
 */
export function deliverActivity({ activityJson, inboxUrls, keyId, privatePem, ctx }) {
  for (const entry of inboxUrls) {
    if (typeof entry === 'string') {
      ctx.waitUntil(deliverToInbox(activityJson, entry, keyId, privatePem));
    } else {
      ctx.waitUntil(deliverToInbox(activityJson, entry.inbox, keyId, privatePem, entry.fallback));
    }
  }
}

async function deliverToInbox(activityJson, inboxUrl, keyId, privatePem, fallbackInboxUrl) {
  if (!validateExternalUrl(inboxUrl)) {
    console.error(`[delivery] SSRF blocked: ${inboxUrl}`);
    return;
  }

  try {
    const headers = await signRequest({
      keyId,
      privatePem,
      method: 'POST',
      url: inboxUrl,
      body: activityJson,
    });

    const response = await fetch(inboxUrl, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/activity+json',
        'User-Agent': 'paa.pub/1.0',
      },
      body: activityJson,
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error(`[delivery] ${inboxUrl} → ${response.status} ${response.statusText}`);
      // Fall back to personal inbox if sharedInbox failed
      if (fallbackInboxUrl && fallbackInboxUrl !== inboxUrl) {
        console.log(`[delivery] Retrying with personal inbox: ${fallbackInboxUrl}`);
        return deliverToInbox(activityJson, fallbackInboxUrl, keyId, privatePem);
      }
    }
  } catch (err) {
    console.error(`[delivery] ${inboxUrl} error: ${err.message}`);
    if (fallbackInboxUrl && fallbackInboxUrl !== inboxUrl) {
      console.log(`[delivery] Retrying with personal inbox: ${fallbackInboxUrl}`);
      return deliverToInbox(activityJson, fallbackInboxUrl, keyId, privatePem);
    }
  }
}

/**
 * Collect unique inbox URLs from a list of actor URIs.
 * Returns {inbox, fallback} pairs so delivery can retry with the personal inbox.
 * @param {string[]} actorUris
 * @param {KVNamespace} kv
 * @returns {Promise<Array<{inbox: string, fallback: string|null}>>}
 */
export async function collectInboxes(actorUris, kv) {
  const seen = new Set();
  const results = [];

  const actors = await Promise.all(
    actorUris.map(uri => fetchRemoteActor(uri, kv))
  );
  for (const actor of actors) {
    if (actor) {
      const shared = getActorSharedInbox(actor);
      const personal = getActorInbox(actor);
      const primary = shared || personal;
      if (primary && !seen.has(primary)) {
        seen.add(primary);
        results.push({ inbox: primary, fallback: shared ? personal : null });
      }
    }
  }

  return results;
}
