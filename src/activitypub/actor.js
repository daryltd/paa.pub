/**
 * Actor document (JSON-LD) and content-negotiated profile card.
 */
import { wantsActivityPub, negotiateType, serializeRdf } from '../solid/conneg.js';
import { solidHeaders } from '../solid/headers.js';
import { parseNTriples } from '../rdf/ntriples.js';

/**
 * Handle GET /{user}/profile/card
 * Returns Actor JSON-LD for AP clients, or Turtle WebID for Solid clients.
 */
export async function handleActor(reqCtx) {
  const { request, params, config, env } = reqCtx;
  const username = params.user;

  if (username !== config.username) {
    return new Response('Not Found', { status: 404 });
  }

  const accept = request.headers.get('Accept') || '';

  if (wantsActivityPub(accept)) {
    return actorJson(reqCtx);
  }

  // Fall through to Solid WebID profile via LDP
  return profileRdf(reqCtx);
}

async function actorJson(reqCtx) {
  const { config, env } = reqCtx;
  const username = config.username;
  const publicPem = await env.APPDATA.get(`ap_public_key:${username}`);

  const actor = {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
    ],
    type: 'Person',
    id: config.actorId,
    inbox: `${config.baseUrl}/${username}/inbox`,
    outbox: `${config.baseUrl}/${username}/outbox`,
    followers: `${config.baseUrl}/${username}/followers`,
    following: `${config.baseUrl}/${username}/following`,
    preferredUsername: username,
    name: username,
    url: `${config.baseUrl}/${username}/profile/card`,
    publicKey: {
      id: config.keyId,
      owner: config.actorId,
      publicKeyPem: publicPem,
    },
  };

  return new Response(JSON.stringify(actor, null, 2), {
    headers: {
      'Content-Type': 'application/activity+json',
      'Cache-Control': 'max-age=300',
    },
  });
}

async function profileRdf(reqCtx) {
  const { request, config, storage } = reqCtx;
  const profileIri = `${config.baseUrl}/${config.username}/profile/card`;
  const webId = config.webId;

  const ntData = await storage.get(`doc:${profileIri}:${webId}`);
  if (!ntData) {
    return new Response('Not Found', { status: 404 });
  }

  const triples = parseNTriples(ntData);
  const accept = request.headers.get('Accept') || 'text/turtle';
  const contentType = negotiateType(accept);
  const body = serializeRdf(triples, contentType, ['foaf', 'solid', 'ldp', 'space', 'rdf']);

  const headers = solidHeaders(profileIri, false);
  headers.set('Content-Type', contentType);
  return new Response(body, { status: 200, headers });
}
