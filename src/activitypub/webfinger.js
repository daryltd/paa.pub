/**
 * WebFinger endpoint (/.well-known/webfinger).
 */
import { userExists } from '../users.js';
import { getUserConfig } from '../config.js';

/**
 * Handle GET /.well-known/webfinger
 */
export async function handleWebFinger(reqCtx) {
  const { url, config, env } = reqCtx;
  const resource = url.searchParams.get('resource');
  if (!resource) {
    return new Response('Missing resource parameter', { status: 400 });
  }

  // Parse acct:user@domain
  const acctMatch = resource.match(/^acct:([^@]+)@(.+)$/);
  if (!acctMatch) {
    return new Response('Invalid resource format', { status: 400 });
  }

  const [, username, domain] = acctMatch;
  if (domain !== config.domain) {
    return new Response('Not Found', { status: 404 });
  }

  // Check if the user exists
  if (!await userExists(env.APPDATA, username)) {
    return new Response('Not Found', { status: 404 });
  }

  const uc = getUserConfig(config, username);

  const jrd = {
    subject: resource,
    aliases: [
      uc.actorId,
      uc.did,
    ],
    links: [
      {
        rel: 'self',
        type: 'application/activity+json',
        href: uc.actorId,
      },
      {
        rel: 'http://webfinger.net/rel/profile-page',
        type: 'text/html',
        href: `${config.baseUrl}/${username}/profile/card`,
      },
      {
        rel: 'self',
        type: 'application/did+ld+json',
        href: `${config.baseUrl}/${username}/did.json`,
      },
    ],
  };

  return new Response(JSON.stringify(jrd), {
    headers: {
      'Content-Type': 'application/jrd+json',
      'Cache-Control': 'max-age=3600',
    },
  });
}
