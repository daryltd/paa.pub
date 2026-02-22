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
import defaultIndexTemplate from './ui/templates/default-index.html';

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
    // Ensure TypeIndex exists (migration for pre-TypeIndex installs)
    await ensureTypeIndex(env, config, storage);
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
  const solid = PREFIXES.solid;

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

  // Document-level triples (foaf:PersonalProfileDocument)
  const profileDocNt = [
    `${iri(profileIri)} ${iri(rdf + 'type')} ${iri(foaf + 'PersonalProfileDocument')} .`,
    `${iri(profileIri)} ${iri(foaf + 'maker')} ${iri(webId)} .`,
    `${iri(profileIri)} ${iri(foaf + 'primaryTopic')} ${iri(webId)} .`,
  ].join('\n');
  await storage.put(`doc:${profileIri}:${profileIri}`, profileDocNt);
  await storage.put(`idx:${profileIri}`, JSON.stringify({ subjects: [webId, profileIri] }));

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

  // 6b. Create TypeIndex documents in settings/
  const settingsIri = `${baseUrl}/${username}/settings/`;
  const privateTypeIndexIri = `${settingsIri}privateTypeIndex`;
  const publicTypeIndexIri = `${settingsIri}publicTypeIndex`;

  const privateTypeIndexNt = [
    `${iri(privateTypeIndexIri)} ${iri(rdf + 'type')} ${iri(solid + 'TypeIndex')} .`,
    `${iri(privateTypeIndexIri)} ${iri(rdf + 'type')} ${iri(solid + 'UnlistedDocument')} .`,
  ].join('\n');
  await storage.put(`doc:${privateTypeIndexIri}:${privateTypeIndexIri}`, privateTypeIndexNt);
  await storage.put(`idx:${privateTypeIndexIri}`, JSON.stringify({ subjects: [privateTypeIndexIri] }));

  const publicTypeIndexNt = [
    `${iri(publicTypeIndexIri)} ${iri(rdf + 'type')} ${iri(solid + 'TypeIndex')} .`,
    `${iri(publicTypeIndexIri)} ${iri(rdf + 'type')} ${iri(solid + 'ListedDocument')} .`,
  ].join('\n');
  await storage.put(`doc:${publicTypeIndexIri}:${publicTypeIndexIri}`, publicTypeIndexNt);
  await storage.put(`idx:${publicTypeIndexIri}`, JSON.stringify({ subjects: [publicTypeIndexIri] }));

  // Add TypeIndex documents to settings/ container
  const settingsContainsNt = [
    `${iri(settingsIri)} ${iri(ldp + 'contains')} ${iri(privateTypeIndexIri)} .`,
    `${iri(settingsIri)} ${iri(ldp + 'contains')} ${iri(publicTypeIndexIri)} .`,
  ].join('\n');
  const existingSettings = await storage.get(`doc:${settingsIri}:${settingsIri}`);
  await storage.put(`doc:${settingsIri}:${settingsIri}`,
    (existingSettings || '') + '\n' + settingsContainsNt);

  // 6c. Create default index.html in root container
  const rootContainerIri = `${baseUrl}/${username}/`;
  const indexHtmlIri = `${rootContainerIri}index.html`;
  const existingIndexBlob = await storage.getBlob(`blob:${indexHtmlIri}`);
  if (!existingIndexBlob) {
    const htmlBytes = new TextEncoder().encode(defaultIndexTemplate);
    await storage.putBlob(`blob:${indexHtmlIri}`, htmlBytes, 'text/html');

    // Add index.html resource metadata to KV
    await storage.put(`idx:${indexHtmlIri}`, JSON.stringify({ binary: true }));
    const metaDoc = `${iri(indexHtmlIri)} <${PREFIXES.dcterms}format> "text/html" .`;
    await storage.put(`doc:${indexHtmlIri}.meta:${indexHtmlIri}`, metaDoc);

    // Add index.html to root container's containment triples
    const indexContainsNt = `${iri(rootContainerIri)} ${iri(ldp + 'contains')} ${iri(indexHtmlIri)} .`;
    const existingRootDoc = await storage.get(`doc:${rootContainerIri}:${rootContainerIri}`);
    if (existingRootDoc && !existingRootDoc.includes(indexHtmlIri)) {
      await storage.put(`doc:${rootContainerIri}:${rootContainerIri}`, existingRootDoc + '\n' + indexContainsNt);
    }

    // ACP: public read for index.html
    await env.APPDATA.put(`acp:${indexHtmlIri}`, JSON.stringify({
      mode: 'public', agents: [], inherit: false,
    }));
  }

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

/**
 * Ensure TypeIndex documents and profile references exist (migration for pre-TypeIndex installs).
 */
async function ensureTypeIndex(env, config, storage) {
  const { username, baseUrl } = config;
  const solid = PREFIXES.solid;
  const rdf = PREFIXES.rdf;
  const ldp = PREFIXES.ldp;
  const webId = `${baseUrl}/${username}/profile/card#me`;
  const profileIri = `${baseUrl}/${username}/profile/card`;
  const settingsIri = `${baseUrl}/${username}/settings/`;
  const privateTypeIndexIri = `${settingsIri}privateTypeIndex`;
  const publicTypeIndexIri = `${settingsIri}publicTypeIndex`;

  // Check if TypeIndex documents exist
  const privateIdx = await storage.get(`idx:${privateTypeIndexIri}`);
  if (!privateIdx) {
    const privateTypeIndexNt = [
      `${iri(privateTypeIndexIri)} ${iri(rdf + 'type')} ${iri(solid + 'TypeIndex')} .`,
      `${iri(privateTypeIndexIri)} ${iri(rdf + 'type')} ${iri(solid + 'UnlistedDocument')} .`,
    ].join('\n');
    await storage.put(`doc:${privateTypeIndexIri}:${privateTypeIndexIri}`, privateTypeIndexNt);
    await storage.put(`idx:${privateTypeIndexIri}`, JSON.stringify({ subjects: [privateTypeIndexIri] }));

    // Add to settings container
    const containNt = `${iri(settingsIri)} ${iri(ldp + 'contains')} ${iri(privateTypeIndexIri)} .`;
    const existingSettings = await storage.get(`doc:${settingsIri}:${settingsIri}`);
    if (existingSettings && !existingSettings.includes(privateTypeIndexIri)) {
      await storage.put(`doc:${settingsIri}:${settingsIri}`, existingSettings + '\n' + containNt);
    }
  }

  const publicIdx = await storage.get(`idx:${publicTypeIndexIri}`);
  if (!publicIdx) {
    const publicTypeIndexNt = [
      `${iri(publicTypeIndexIri)} ${iri(rdf + 'type')} ${iri(solid + 'TypeIndex')} .`,
      `${iri(publicTypeIndexIri)} ${iri(rdf + 'type')} ${iri(solid + 'ListedDocument')} .`,
    ].join('\n');
    await storage.put(`doc:${publicTypeIndexIri}:${publicTypeIndexIri}`, publicTypeIndexNt);
    await storage.put(`idx:${publicTypeIndexIri}`, JSON.stringify({ subjects: [publicTypeIndexIri] }));

    // Add to settings container
    const containNt = `${iri(settingsIri)} ${iri(ldp + 'contains')} ${iri(publicTypeIndexIri)} .`;
    const existingSettings = await storage.get(`doc:${settingsIri}:${settingsIri}`);
    if (existingSettings && !existingSettings.includes(publicTypeIndexIri)) {
      await storage.put(`doc:${settingsIri}:${settingsIri}`, existingSettings + '\n' + containNt);
    }
  }

  // Ensure profile has TypeIndex references
  const profileDoc = await storage.get(`doc:${profileIri}:${webId}`);
  if (profileDoc && !profileDoc.includes('privateTypeIndex')) {
    const typeIndexTriples = [
      `${iri(webId)} ${iri(solid + 'privateTypeIndex')} ${iri(privateTypeIndexIri)} .`,
      `${iri(webId)} ${iri(solid + 'publicTypeIndex')} ${iri(publicTypeIndexIri)} .`,
    ].join('\n');
    await storage.put(`doc:${profileIri}:${webId}`, profileDoc + '\n' + typeIndexTriples);
  }

  // Ensure profile has document-level triples (PersonalProfileDocument)
  const foaf = PREFIXES.foaf;
  const profileDocTriples = await storage.get(`doc:${profileIri}:${profileIri}`);
  if (!profileDocTriples) {
    const docNt = [
      `${iri(profileIri)} ${iri(rdf + 'type')} ${iri(foaf + 'PersonalProfileDocument')} .`,
      `${iri(profileIri)} ${iri(foaf + 'maker')} ${iri(webId)} .`,
      `${iri(profileIri)} ${iri(foaf + 'primaryTopic')} ${iri(webId)} .`,
    ].join('\n');
    await storage.put(`doc:${profileIri}:${profileIri}`, docNt);
    // Update idx to include both subjects
    const idx = await storage.get(`idx:${profileIri}`);
    if (idx) {
      const parsed = JSON.parse(idx);
      if (!parsed.subjects.includes(profileIri)) {
        parsed.subjects.push(profileIri);
        await storage.put(`idx:${profileIri}`, JSON.stringify(parsed));
      }
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
    `${iri(webId)} ${iri(solid + 'privateTypeIndex')} ${iri(baseUrl + '/' + username + '/settings/privateTypeIndex')} .`,
    `${iri(webId)} ${iri(solid + 'publicTypeIndex')} ${iri(baseUrl + '/' + username + '/settings/publicTypeIndex')} .`,
    // Security key for ActivityPub
    `${iri(keyId)} ${iri(rdf + 'type')} ${iri('https://w3id.org/security#Key')} .`,
    `${iri(keyId)} ${iri('https://w3id.org/security#owner')} ${iri(webId)} .`,
    `${iri(keyId)} ${iri('https://w3id.org/security#publicKeyPem')} ${literal(publicPem)} .`,
  ].join('\n');
}

