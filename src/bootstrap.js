/**
 * First-run bootstrap: create user, containers, keypair, WebID, ACLs.
 *
 * Writes ACLs directly to TRIPLESTORE KV via CloudflareAdapter.put()
 * to bypass WAC (no ACLs exist yet on first run).
 */
import { hashPassword } from './auth/password.js';
import { generateRSAKeyPair } from './crypto/rsa.js';
import { iri, literal, typedLiteral } from './rdf/ntriples.js';
import { PREFIXES } from './rdf/prefixes.js';

let bootstrapped = false;

/**
 * Ensure the system is bootstrapped. Idempotent.
 * @param {object} env
 * @param {object} config
 * @param {import('@s20e/adapters/cloudflare').CloudflareAdapter} storage
 */
export async function ensureBootstrapped(env, config, storage) {
  if (bootstrapped) return;

  const flag = await env.APPDATA.get('user_initialized');
  if (flag === 'true') {
    bootstrapped = true;
    return;
  }

  if (!config.password) {
    throw new Error('PAA_PASSWORD environment variable must be set');
  }

  await bootstrap(env, config, storage);
  bootstrapped = true;
}

async function bootstrap(env, config, storage) {
  const { username, baseUrl } = config;

  // 1. Hash password and create user record
  const passwordHash = await hashPassword(config.password);
  await env.APPDATA.put(`user:${username}`, passwordHash);

  // 2. Generate RSA keypair for ActivityPub
  const { privatePem, publicPem } = await generateRSAKeyPair();
  await env.APPDATA.put(`ap_private_key:${username}`, privatePem);
  await env.APPDATA.put(`ap_public_key:${username}`, publicPem);

  // 3. Initialize empty AP collections
  await env.APPDATA.put(`ap_followers:${username}`, '[]');
  await env.APPDATA.put(`ap_following:${username}`, '[]');
  await env.APPDATA.put(`ap_outbox_index:${username}`, '[]');
  await env.APPDATA.put(`ap_inbox_index:${username}`, '[]');
  await env.APPDATA.put(`quota:${username}`, JSON.stringify({ usedBytes: 0 }));

  // 4. Create containers and their ACLs
  const containers = [
    `${baseUrl}/${username}/`,
    `${baseUrl}/${username}/profile/`,
    `${baseUrl}/${username}/public/`,
    `${baseUrl}/${username}/private/`,
    `${baseUrl}/${username}/settings/`,
  ];

  const webId = `${baseUrl}/${username}/profile/card#me`;
  const rdf = PREFIXES.rdf;
  const ldp = PREFIXES.ldp;
  const acl = PREFIXES.acl;
  const foaf = PREFIXES.foaf;

  for (const containerIri of containers) {
    // Write container type triple
    const containerNt = `${iri(containerIri)} ${iri(rdf + 'type')} ${iri(ldp + 'BasicContainer')} .`;
    await storage.put(`doc:${containerIri}:${containerIri}`, containerNt);
    await storage.put(`idx:${containerIri}`, JSON.stringify({ subjects: [containerIri] }));

    // Write ACL: owner has full control, public read on public container
    const isPublic = containerIri.endsWith('/public/');
    const isRoot = containerIri === `${baseUrl}/${username}/`;
    const aclNt = buildContainerAcl(containerIri, webId, isPublic || isRoot, acl, foaf);
    await storage.put(`acl:${containerIri}`, aclNt);
  }

  // 5. Create WebID profile document
  const profileIri = `${baseUrl}/${username}/profile/card`;
  const profileNt = buildProfileNTriples(profileIri, webId, username, baseUrl, publicPem);
  await storage.put(`doc:${profileIri}:${webId}`, profileNt);
  await storage.put(`idx:${profileIri}`, JSON.stringify({ subjects: [webId] }));

  // ACL for profile: owner control, public read
  const profileAcl = buildContainerAcl(profileIri, webId, true, acl, foaf);
  await storage.put(`acl:${profileIri}`, profileAcl);

  // 6. Add profile/card to profile/ container
  const profileContainerIri = `${baseUrl}/${username}/profile/`;
  const containsNt = `${iri(profileContainerIri)} ${iri(ldp + 'contains')} ${iri(profileIri)} .`;
  const existingDoc = await storage.get(`doc:${profileContainerIri}:${profileContainerIri}`);
  await storage.put(`doc:${profileContainerIri}:${profileContainerIri}`,
    (existingDoc || '') + '\n' + containsNt);

  // 7. Mark as initialized
  await env.APPDATA.put('user_initialized', 'true');
}

function buildContainerAcl(resourceIri, webId, publicRead, acl, foaf) {
  const lines = [
    `${iri(resourceIri + '.acl#owner')} ${iri(acl + 'agent')} ${iri(webId)} .`,
    `${iri(resourceIri + '.acl#owner')} ${iri(acl + 'accessTo')} ${iri(resourceIri)} .`,
    `${iri(resourceIri + '.acl#owner')} ${iri(acl + 'default')} ${iri(resourceIri)} .`,
    `${iri(resourceIri + '.acl#owner')} ${iri(acl + 'mode')} ${iri(acl + 'Read')} .`,
    `${iri(resourceIri + '.acl#owner')} ${iri(acl + 'mode')} ${iri(acl + 'Write')} .`,
    `${iri(resourceIri + '.acl#owner')} ${iri(acl + 'mode')} ${iri(acl + 'Control')} .`,
    `${iri(resourceIri + '.acl#owner')} ${iri(PREFIXES.rdf + 'type')} ${iri(acl + 'Authorization')} .`,
  ];

  if (publicRead) {
    lines.push(
      `${iri(resourceIri + '.acl#public')} ${iri(acl + 'agentClass')} ${iri(foaf + 'Agent')} .`,
      `${iri(resourceIri + '.acl#public')} ${iri(acl + 'accessTo')} ${iri(resourceIri)} .`,
      `${iri(resourceIri + '.acl#public')} ${iri(acl + 'default')} ${iri(resourceIri)} .`,
      `${iri(resourceIri + '.acl#public')} ${iri(acl + 'mode')} ${iri(acl + 'Read')} .`,
      `${iri(resourceIri + '.acl#public')} ${iri(PREFIXES.rdf + 'type')} ${iri(acl + 'Authorization')} .`,
    );
  }

  return lines.join('\n');
}

function buildProfileNTriples(profileIri, webId, username, baseUrl, publicPem) {
  const rdf = PREFIXES.rdf;
  const foaf = PREFIXES.foaf;
  const solid = PREFIXES.solid;
  const ldp = PREFIXES.ldp;
  const space = PREFIXES.space;
  const keyId = `${profileIri}#main-key`;

  return [
    `${iri(webId)} ${iri(rdf + 'type')} ${iri(foaf + 'Person')} .`,
    `${iri(webId)} ${iri(foaf + 'name')} ${literal(username)} .`,
    `${iri(webId)} ${iri(foaf + 'isPrimaryTopicOf')} ${iri(profileIri)} .`,
    `${iri(webId)} ${iri(solid + 'oidcIssuer')} ${iri(baseUrl)} .`,
    `${iri(webId)} ${iri(space + 'storage')} ${iri(baseUrl + '/' + username + '/')} .`,
    `${iri(webId)} ${iri(ldp + 'inbox')} ${iri(baseUrl + '/' + username + '/inbox')} .`,
    // Security key for ActivityPub
    `${iri(keyId)} ${iri(rdf + 'type')} ${iri('https://w3id.org/security#Key')} .`,
    `${iri(keyId)} ${iri('https://w3id.org/security#owner')} ${iri(webId)} .`,
    `${iri(keyId)} ${iri('https://w3id.org/security#publicKeyPem')} ${literal(publicPem)} .`,
  ].join('\n');
}
