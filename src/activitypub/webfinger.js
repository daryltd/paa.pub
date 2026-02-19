/**
 * WebFinger endpoint (/.well-known/webfinger).
 */

/**
 * Handle GET /.well-known/webfinger
 */
export async function handleWebFinger(reqCtx) {
  const { url, config } = reqCtx;
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
  if (username !== config.username || domain !== config.domain) {
    return new Response('Not Found', { status: 404 });
  }

  const jrd = {
    subject: resource,
    links: [
      {
        rel: 'self',
        type: 'application/activity+json',
        href: config.actorId,
      },
      {
        rel: 'http://webfinger.net/rel/profile-page',
        type: 'text/html',
        href: `${config.baseUrl}/${username}/profile/card`,
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
