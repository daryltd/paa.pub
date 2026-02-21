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
    // Check if domain changed since last bootstrap (or was never recorded)
    const storedDomain = await env.APPDATA.get('bootstrap_domain');
    if (storedDomain !== config.domain) {
      console.log(`Bootstrap domain mismatch: stored=${storedDomain} current=${config.domain}, re-bootstrapping`);
      await bootstrap(env, config, storage);
    }
    // Ensure ACP policies exist (migration for pre-ACP installs)
    await ensureAcpPolicies(env, config);
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

  // 1. Hash password and create user record (skip if already exists)
  const existingUser = await env.APPDATA.get(`user:${username}`);
  if (!existingUser) {
    const passwordHash = await hashPassword(config.password);
    await env.APPDATA.put(`user:${username}`, passwordHash);
  }

  // 2. Generate RSA keypair for ActivityPub (skip if already exists)
  let publicPem = await env.APPDATA.get(`ap_public_key:${username}`);
  if (!publicPem) {
    const keyPair = await generateRSAKeyPair();
    await env.APPDATA.put(`ap_private_key:${username}`, keyPair.privatePem);
    await env.APPDATA.put(`ap_public_key:${username}`, keyPair.publicPem);
    publicPem = keyPair.publicPem;
  }

  // 3. Initialize empty AP collections and friends list (skip if already exists)
  if (!await env.APPDATA.get(`ap_followers:${username}`)) {
    await env.APPDATA.put(`ap_followers:${username}`, '[]');
    await env.APPDATA.put(`ap_following:${username}`, '[]');
    await env.APPDATA.put(`ap_outbox_index:${username}`, '[]');
    await env.APPDATA.put(`ap_inbox_index:${username}`, '[]');
    await env.APPDATA.put(`quota:${username}`, JSON.stringify({ usedBytes: 0 }));
  }
  if (!await env.APPDATA.get(`friends:${username}`)) {
    await env.APPDATA.put(`friends:${username}`, '[]');
  }

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

    // Write WAC ACL (for kernel compatibility)
    const isPublic = containerIri.endsWith('/public/');
    const isRoot = containerIri === `${baseUrl}/${username}/`;
    const aclNt = buildContainerAcl(containerIri, webId, isPublic || isRoot, acl, foaf);
    await storage.put(`acl:${containerIri}`, aclNt);

    // Write ACP policy — root defaults to private, public/ is public
    const acpMode = isPublic ? 'public' : 'private';
    await env.APPDATA.put(`acp:${containerIri}`, JSON.stringify({
      mode: acpMode, agents: [], inherit: true,
    }));
  }

  // 5. Create WebID profile document
  const profileIri = `${baseUrl}/${username}/profile/card`;
  const profileNt = buildProfileNTriples(profileIri, webId, username, baseUrl, publicPem);
  await storage.put(`doc:${profileIri}:${webId}`, profileNt);
  await storage.put(`idx:${profileIri}`, JSON.stringify({ subjects: [webId] }));

  // ACL + ACP for profile: public read
  const profileAcl = buildContainerAcl(profileIri, webId, true, acl, foaf);
  await storage.put(`acl:${profileIri}`, profileAcl);
  await env.APPDATA.put(`acp:${profileIri}`, JSON.stringify({
    mode: 'public', agents: [], inherit: false,
  }));

  // 6. Add profile/card to profile/ container
  const profileContainerIri = `${baseUrl}/${username}/profile/`;
  const containsNt = `${iri(profileContainerIri)} ${iri(ldp + 'contains')} ${iri(profileIri)} .`;
  const existingDoc = await storage.get(`doc:${profileContainerIri}:${profileContainerIri}`);
  await storage.put(`doc:${profileContainerIri}:${profileContainerIri}`,
    (existingDoc || '') + '\n' + containsNt);

  // 7. Mark as initialized and store the domain used
  await env.APPDATA.put('user_initialized', 'true');
  await env.APPDATA.put('bootstrap_domain', config.domain);
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

/**
 * Ensure ACP policies exist for core containers (migration for pre-ACP installs).
 */
async function ensureAcpPolicies(env, config) {
  const { username, baseUrl } = config;
  const policies = [
    // Root container: private by default (safer default)
    [`acp:${baseUrl}/${username}/`, { mode: 'private', agents: [], inherit: true }],
    // Profile: public (WebID must be readable)
    [`acp:${baseUrl}/${username}/profile/`, { mode: 'public', agents: [], inherit: true }],
    [`acp:${baseUrl}/${username}/profile/card`, { mode: 'public', agents: [], inherit: false }],
    // Public container: public
    [`acp:${baseUrl}/${username}/public/`, { mode: 'public', agents: [], inherit: true }],
    // Private container: private
    [`acp:${baseUrl}/${username}/private/`, { mode: 'private', agents: [], inherit: true }],
    // Settings: private
    [`acp:${baseUrl}/${username}/settings/`, { mode: 'private', agents: [], inherit: true }],
  ];

  for (const [key, policy] of policies) {
    const existing = await env.APPDATA.get(key);
    if (!existing) {
      await env.APPDATA.put(key, JSON.stringify(policy));
    }
  }
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
