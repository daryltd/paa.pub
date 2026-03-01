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
 * @param {ExecutionContext} opts.ctx - Cloudflare Workers execution context
 */
export function deliverActivity({ activityJson, inboxUrls, keyId, privatePem, ctx }) {
  for (const inboxUrl of inboxUrls) {
    ctx.waitUntil(deliverToInbox(activityJson, inboxUrl, keyId, privatePem));
  }
}

async function deliverToInbox(activityJson, inboxUrl, keyId, privatePem) {
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
    });

    if (!response.ok) {
      console.error(`Delivery to ${inboxUrl} failed: ${response.status} ${response.statusText}`);
    }
  } catch (err) {
    console.error(`Delivery to ${inboxUrl} error:`, err);
  }
}

/**
 * Collect unique inbox URLs from a list of actor URIs.
 * @param {string[]} actorUris
 * @param {KVNamespace} kv
 * @returns {Promise<string[]>}
 */
export async function collectInboxes(actorUris, kv) {
  const inboxes = new Set();

  const actors = await Promise.all(
    actorUris.map(uri => fetchRemoteActor(uri, kv))
  );
  for (const actor of actors) {
    if (actor) {
      const inbox = getActorSharedInbox(actor) || getActorInbox(actor);
      if (inbox) inboxes.add(inbox);
    }
  }

  return [...inboxes];
}
