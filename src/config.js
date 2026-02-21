/**
 * Read configuration from Cloudflare Worker environment bindings.
 * @param {object} env - Cloudflare Worker env object
 * @param {Request} [request] - incoming request (used to auto-detect domain)
 * @returns {object} config
 */
export function getConfig(env, request) {
  const username = env.PAA_USERNAME || 'admin';
  const password = env.PAA_PASSWORD || '';

  let domain = env.PAA_DOMAIN || '';
  let protocol;
  if (!domain && request) {
    const url = new URL(request.url);
    domain = url.host;
    protocol = url.protocol.replace(':', '');
  } else {
    domain = domain || 'localhost:8787';
    protocol = domain.startsWith('localhost') ? 'http' : 'https';
  }
  const baseUrl = `${protocol}://${domain}`;

  return {
    username,
    password,
    domain,
    baseUrl,
    protocol,
    actorId: `${baseUrl}/${username}/profile/card#me`,
    keyId: `${baseUrl}/${username}/profile/card#main-key`,
    webId: `${baseUrl}/${username}/profile/card#me`,
  };
}
