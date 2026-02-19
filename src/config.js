/**
 * Read configuration from Cloudflare Worker environment bindings.
 * @param {object} env - Cloudflare Worker env object
 * @returns {object} config
 */
export function getConfig(env) {
  const username = env.PAA_USERNAME || 'admin';
  const password = env.PAA_PASSWORD || '';
  const domain = env.PAA_DOMAIN || 'localhost:8787';
  const protocol = domain.startsWith('localhost') ? 'http' : 'https';
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
