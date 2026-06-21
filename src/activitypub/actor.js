/**
 * ActivityPub Actor document and content-negotiated profile card.
 *
 * The profile card endpoint (/{user}/profile/card) serves two representations
 * based on the Accept header:
 *
 *   - `application/activity+json` or `application/ld+json` → ActivityPub Actor
 *     JSON-LD document with inbox, outbox, followers, following endpoints,
 *     and the RSA public key for HTTP Signature verification
 *
 *   - `text/turtle` or other RDF types → Solid WebID profile document
 *     with foaf:Person triples, read from KV storage
 *
 * The /profile/card shortcut (without /{user}/ prefix) also works for
 * single-user convenience.
 */
import { wantsActivityPub, negotiateType, serializeRdf } from '../solid/conneg.js';
import { solidHeaders, buildWacAllow } from '../solid/headers.js';
import { parseNTriples } from '../rdf/ntriples.js';
import { userExists } from '../users.js';
import { getUserConfig } from '../config.js';

/**
 * Handle GET /{user}/profile/card
 * Returns Actor JSON-LD for AP clients, or Turtle WebID for Solid clients.
 */
export async function handleActor(reqCtx) {
  const { request, params, config, env } = reqCtx;
  const username = params.user || config.adminUsername;

  if (!await userExists(env.APPDATA, username)) {
    return new Response('Not Found', { status: 404 });
  }

  const accept = request.headers.get('Accept') || '';

  // Prefer Solid profile if the client accepts Turtle or N-Triples
  const lower = accept.toLowerCase();
  if (lower.includes('text/turtle') || lower.includes('application/n-triples')) {
    return profileRdf(reqCtx, username);
  }

  if (wantsActivityPub(accept)) {
    return actorJson(reqCtx, username);
  }

  // Default to Solid WebID profile
  return profileRdf(reqCtx, username);
}

async function actorJson(reqCtx, username) {
  const { config, env } = reqCtx;
  const uc = getUserConfig(config, username);
  const publicPem = await env.APPDATA.get(`ap_public_key:${username}`);

  const actor = {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
    ],
    type: 'Person',
    id: uc.actorId,
    inbox: `${config.baseUrl}/${username}/inbox`,
    outbox: `${config.baseUrl}/${username}/outbox`,
    followers: `${config.baseUrl}/${username}/followers`,
    following: `${config.baseUrl}/${username}/following`,
    preferredUsername: username,
    name: username,
    url: `${config.baseUrl}/${username}/profile/card`,
    alsoKnownAs: [uc.did],
    publicKey: {
      id: uc.keyId,
      owner: uc.actorId,
      publicKeyPem: publicPem,
    },
    endpoints: {
      sharedInbox: `${config.baseUrl}/inbox`,
    },
  };

  return new Response(JSON.stringify(actor, null, 2), {
    headers: {
      'Content-Type': 'application/activity+json',
      'Cache-Control': 'max-age=300',
    },
  });
}

async function profileRdf(reqCtx, username) {
  const { request, config, storage, user } = reqCtx;
  const uc = getUserConfig(config, username);
  const profileIri = `${config.baseUrl}/${username}/profile/card`;

  // Read all subjects from the profile document index
  const idx = await storage.get(`idx:${profileIri}`);
  if (!idx) {
    return new Response('Not Found', { status: 404 });
  }
  const { subjects } = JSON.parse(idx);
  const triples = [];
  for (const subj of subjects) {
    const nt = await storage.get(`doc:${profileIri}:${subj}`);
    if (nt) triples.push(...parseNTriples(nt));
  }
  const accept = request.headers.get('Accept') || 'text/turtle';
  const contentType = negotiateType(accept);
  const body = serializeRdf(triples, contentType, ['foaf', 'solid', 'ldp', 'space', 'rdf', 'owl']);

  const headers = solidHeaders(profileIri, false);
  headers.set('Content-Type', contentType);
  headers.set('Vary', 'Accept, Authorization, Origin');
  // Tell Solid apps whether the profile is writable
  if (user === username) {
    headers.set('WAC-Allow', buildWacAllow({
      user: ['read', 'write', 'append', 'control'],
      public: ['read'],
    }));
  } else {
    headers.set('WAC-Allow', buildWacAllow({
      user: [],
      public: ['read'],
    }));
  }
  return new Response(body, { status: 200, headers });
}
