/**
 * DID Document generation for the did:web method.
 *
 * Serves DID documents per-user at /{user}/did.json and
 * a server-level document at /.well-known/did.json.
 *
 * The did:web method maps DIDs to HTTPS URLs:
 *   did:web:paa.pub:luke  -> https://paa.pub/luke/did.json
 *   did:web:paa.pub       -> https://paa.pub/.well-known/did.json
 */
import { getUserConfig } from '../config.js';
import { userExists } from '../users.js';
import { pemToJwk } from '../crypto/keys.js';

/**
 * Construct the did:web identifier for a user or server.
 * @param {string} domain - e.g. "paa.pub" or "localhost:8787"
 * @param {string} [username] - omit for server-level DID
 * @returns {string}
 */
export function buildDidWeb(domain, username) {
  const encodedDomain = domain.replace(/:/g, '%3A');
  return username
    ? `did:web:${encodedDomain}:${username}`
    : `did:web:${encodedDomain}`;
}

/**
 * Handle GET /{user}/did.json — per-user DID document.
 */
export async function handleUserDidDocument(reqCtx) {
  const { params, config, env } = reqCtx;
  const username = params.user;

  if (!await userExists(env.APPDATA, username)) {
    return new Response('Not Found', { status: 404 });
  }

  const publicPem = await env.APPDATA.get(`ap_public_key:${username}`);
  if (!publicPem) {
    return new Response('Not Found', { status: 404 });
  }

  const uc = getUserConfig(config, username);
  const did = uc.did;
  const jwk = await pemToJwk(publicPem);
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  const doc = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/jws-2020/v1',
    ],
    id: did,
    alsoKnownAs: [
      uc.webId,
      `acct:${username}@${config.domain}`,
    ],
    verificationMethod: [{
      id: `${did}#main-key`,
      type: 'JsonWebKey2020',
      controller: did,
      publicKeyJwk: jwk,
    }],
    authentication: [`${did}#main-key`],
    assertionMethod: [`${did}#main-key`],
    service: [
      {
        id: `${did}#solid`,
        type: 'SolidWebID',
        serviceEndpoint: uc.webId,
      },
      {
        id: `${did}#activitypub`,
        type: 'ActivityPubActor',
        serviceEndpoint: uc.actorId,
      },
      {
        id: `${did}#solid-storage`,
        type: 'SolidStorage',
        serviceEndpoint: `${config.baseUrl}/${username}/`,
      },
      {
        id: `${did}#oidc-issuer`,
        type: 'OIDCIssuer',
        serviceEndpoint: config.baseUrl,
      },
    ],
  };

  return new Response(JSON.stringify(doc, null, 2), {
    headers: {
      'Content-Type': 'application/did+ld+json',
      'Cache-Control': 'max-age=300',
    },
  });
}

/**
 * Handle GET /.well-known/did.json — server-level DID document.
 */
export async function handleServerDidDocument(reqCtx) {
  const { config, env } = reqCtx;

  const publicPem = await env.APPDATA.get('oidc_public_key');
  if (!publicPem) {
    return new Response('Not Found', { status: 404 });
  }

  const did = buildDidWeb(config.domain);
  const jwk = await pemToJwk(publicPem);
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  const doc = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/jws-2020/v1',
    ],
    id: did,
    verificationMethod: [{
      id: `${did}#oidc-key`,
      type: 'JsonWebKey2020',
      controller: did,
      publicKeyJwk: jwk,
    }],
    authentication: [`${did}#oidc-key`],
    service: [
      {
        id: `${did}#oidc-issuer`,
        type: 'OIDCIssuer',
        serviceEndpoint: config.baseUrl,
      },
      {
        id: `${did}#shared-inbox`,
        type: 'ActivityPubSharedInbox',
        serviceEndpoint: `${config.baseUrl}/inbox`,
      },
    ],
  };

  return new Response(JSON.stringify(doc, null, 2), {
    headers: {
      'Content-Type': 'application/did+ld+json',
      'Cache-Control': 'max-age=3600',
    },
  });
}
