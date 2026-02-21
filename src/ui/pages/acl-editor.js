/**
 * Access Control Policy (ACP) editor with simplified interface.
 *
 * Modes:
 *   public     — Anyone can read
 *   unlisted   — Anyone with the link can read (not shown in container listings)
 *   friends    — Only WebIDs in the friends list can read
 *   private    — Only the owner can access
 *   custom     — Specific WebIDs granted access
 *
 * The owner always has full access (enforced by session/token auth).
 * ACP policies are stored as JSON in APPDATA KV at key `acp:{resourceIri}`.
 */
import { renderPage } from '../shell.js';
import template from '../templates/acl-editor.html';
import aclToggleScript from '../client/acl-toggle.js';
import { requireAuth } from '../../auth/middleware.js';

/**
 * Handle GET /acp/**
 */
export async function renderAclEditor(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env, url } = reqCtx;
  const username = config.username;
  const path = url.pathname.replace(/^\/acp\/?/, '') || `${username}/`;
  const resourceIri = `${config.baseUrl}/${path}`;
  const isDir = path.endsWith('/');

  // Load current policy
  const policy = await loadPolicy(env.APPDATA, resourceIri);
  const friends = await loadFriends(env.APPDATA, username);

  const modeOptions = [
    { value: 'public', label: 'Public', description: 'Anyone can discover and read this resource.' },
    { value: 'unlisted', label: 'Public (unlisted)', description: 'Anyone with the direct link can read, but not listed in container indexes.' },
    { value: 'friends', label: 'Friends', description: 'Only people in your friends list can read.' },
    { value: 'private', label: 'Private', description: 'Only you can access this resource.' },
    { value: 'custom', label: 'Custom', description: 'Grant read access to specific WebIDs.' },
  ].map(opt => ({
    ...opt,
    checked: policy.mode === opt.value ? 'checked' : '',
    bgColor: policy.mode === opt.value ? '#f0f0ff' : 'transparent',
  }));

  return renderPage('Access Policy', template, {
    resourceIri,
    isDir,
    path,
    modeOptions,
    customDisplay: policy.mode === 'custom' ? 'block' : 'none',
    agentsText: (policy.agents || []).join('\n'),
    inheritChecked: policy.inherit !== false ? 'checked' : '',
    friends,
    hasFriends: friends.length > 0,
    turtlePolicy: policyToTurtle(policy, resourceIri, config.webId, friends),
    clientScript: aclToggleScript,
  }, { user: username, nav: 'storage' });
}

/**
 * Handle POST /acp/**
 */
export async function handleAclUpdate(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { request, config, env, url } = reqCtx;
  const username = config.username;
  const path = url.pathname.replace(/^\/acp\/?/, '') || `${username}/`;
  const resourceIri = `${config.baseUrl}/${path}`;

  const form = await request.formData();
  const action = form.get('action');

  if (action === 'save_policy') {
    const mode = form.get('mode') || 'private';
    const agentsRaw = form.get('agents') || '';
    const agents = agentsRaw.split('\n').map(a => a.trim()).filter(Boolean);
    const inherit = form.get('inherit') === '1';

    const policy = { mode, agents, inherit };
    await env.APPDATA.put(`acp:${resourceIri}`, JSON.stringify(policy));
  }

  if (action === 'add_friend') {
    const webid = (form.get('webid') || '').trim();
    if (webid) {
      const friends = await loadFriends(env.APPDATA, username);
      if (!friends.includes(webid)) {
        friends.push(webid);
        await env.APPDATA.put(`friends:${username}`, JSON.stringify(friends));
      }
    }
  }

  if (action === 'remove_friend') {
    const webid = (form.get('webid') || '').trim();
    const friends = await loadFriends(env.APPDATA, username);
    const filtered = friends.filter(f => f !== webid);
    await env.APPDATA.put(`friends:${username}`, JSON.stringify(filtered));
  }

  return new Response(null, { status: 302, headers: { 'Location': `/acp/${path}` } });
}

// ── Policy helpers ───────────────────────────────────

const DEFAULT_POLICY = { mode: 'private', agents: [], inherit: true };

async function loadPolicy(kv, resourceIri) {
  const data = await kv.get(`acp:${resourceIri}`);
  return data ? JSON.parse(data) : { ...DEFAULT_POLICY };
}

async function loadFriends(kv, username) {
  const data = await kv.get(`friends:${username}`);
  return data ? JSON.parse(data) : [];
}

/**
 * Check if a resource is readable by a given agent based on ACP.
 * Walks up the container hierarchy looking for an inherited policy.
 *
 * @param {KVNamespace} kv - APPDATA
 * @param {string} resourceIri
 * @param {string|null} agentWebId
 * @param {string} ownerWebId
 * @param {string} username
 * @returns {Promise<{readable: boolean, listed: boolean}>}
 */
export async function checkAcpAccess(kv, resourceIri, agentWebId, ownerWebId, username) {
  // Owner always has full access
  if (agentWebId === ownerWebId) return { readable: true, listed: true };

  // Walk up the hierarchy to find applicable policy
  let uri = resourceIri;
  while (uri) {
    const data = await kv.get(`acp:${uri}`);
    if (data) {
      const policy = JSON.parse(data);
      return evaluatePolicy(policy, agentWebId, kv, username);
    }
    // Go up to parent
    const parsed = new URL(uri);
    const path = parsed.pathname;
    const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
    const lastSlash = trimmed.lastIndexOf('/');
    if (lastSlash <= 0) break;
    uri = `${parsed.origin}${trimmed.slice(0, lastSlash + 1)}`;
  }

  // No policy found — default to private
  return { readable: false, listed: false };
}

async function evaluatePolicy(policy, agentWebId, kv, username) {
  switch (policy.mode) {
    case 'public':
      return { readable: true, listed: true };
    case 'unlisted':
      return { readable: true, listed: false };
    case 'friends': {
      if (!agentWebId) return { readable: false, listed: false };
      const friends = await loadFriends(kv, username);
      return { readable: friends.includes(agentWebId), listed: false };
    }
    case 'custom': {
      if (!agentWebId) return { readable: false, listed: false };
      return { readable: (policy.agents || []).includes(agentWebId), listed: false };
    }
    case 'private':
    default:
      return { readable: false, listed: false };
  }
}

function policyToTurtle(policy, resourceIri, ownerWebId, friends) {
  const acrIri = `${resourceIri}.acr`;
  const lines = [
    '@prefix acp: <http://www.w3.org/ns/solid/acp#> .',
    '@prefix acl: <http://www.w3.org/ns/auth/acl#> .',
    '',
    `<${acrIri}> a acp:AccessControlResource ;`,
    `    acp:resource <${resourceIri}> ;`,
    `    acp:accessControl <${acrIri}#control> .`,
    '',
    `<${acrIri}#control> a acp:AccessControl ;`,
    `    acp:apply <${acrIri}#ownerPolicy> .`,
    '',
    '# Owner always has full access',
    `<${acrIri}#ownerPolicy> a acp:Policy ;`,
    `    acp:allow acl:Read, acl:Write, acl:Append, acl:Control ;`,
    `    acp:allOf <${acrIri}#ownerMatcher> .`,
    '',
    `<${acrIri}#ownerMatcher> a acp:Matcher ;`,
    `    acp:agent <${ownerWebId}> .`,
  ];

  if (policy.mode === 'public') {
    lines.push(
      '',
      '# Public read access',
      `<${acrIri}#control> acp:apply <${acrIri}#publicPolicy> .`,
      `<${acrIri}#publicPolicy> a acp:Policy ;`,
      `    acp:allow acl:Read ;`,
      `    acp:allOf <${acrIri}#publicMatcher> .`,
      `<${acrIri}#publicMatcher> a acp:Matcher ;`,
      `    acp:agent acp:PublicAgent .`,
    );
  } else if (policy.mode === 'unlisted') {
    lines.push(
      '',
      '# Unlisted read access (public but not discoverable)',
      `<${acrIri}#control> acp:apply <${acrIri}#unlistedPolicy> .`,
      `<${acrIri}#unlistedPolicy> a acp:Policy ;`,
      `    acp:allow acl:Read ;`,
      `    acp:allOf <${acrIri}#unlistedMatcher> .`,
      `<${acrIri}#unlistedMatcher> a acp:Matcher ;`,
      `    acp:agent acp:PublicAgent .`,
    );
  } else if (policy.mode === 'friends') {
    for (let i = 0; i < friends.length; i++) {
      lines.push(
        '',
        `# Friend: ${friends[i]}`,
        `<${acrIri}#control> acp:apply <${acrIri}#friendPolicy${i}> .`,
        `<${acrIri}#friendPolicy${i}> a acp:Policy ;`,
        `    acp:allow acl:Read ;`,
        `    acp:allOf <${acrIri}#friendMatcher${i}> .`,
        `<${acrIri}#friendMatcher${i}> a acp:Matcher ;`,
        `    acp:agent <${friends[i]}> .`,
      );
    }
  } else if (policy.mode === 'custom') {
    for (let i = 0; i < (policy.agents || []).length; i++) {
      lines.push(
        '',
        `# Custom agent: ${policy.agents[i]}`,
        `<${acrIri}#control> acp:apply <${acrIri}#customPolicy${i}> .`,
        `<${acrIri}#customPolicy${i}> a acp:Policy ;`,
        `    acp:allow acl:Read ;`,
        `    acp:allOf <${acrIri}#customMatcher${i}> .`,
        `<${acrIri}#customMatcher${i}> a acp:Matcher ;`,
        `    acp:agent <${policy.agents[i]}> .`,
      );
    }
  }

  return lines.join('\n');
}
