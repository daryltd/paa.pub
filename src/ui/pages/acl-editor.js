/**
 * Access Control Policy (ACP) editor with simplified interface.
 *
 * Modes:
 *   inherit    — Inherit policy from parent container (default for new resources)
 *   public     — Anyone can read
 *   unlisted   — Anyone with the link can read (not shown in container listings)
 *   friends    — Only WebIDs in the friends list can read
 *   private    — Only the owner can access
 *   custom     — Specific WebIDs granted access
 *
 * The owner always has full access (enforced by session/token auth).
 * ACP policies are stored as JSON in APPDATA KV at key `acp:{resourceIri}`.
 *
 * Inheritance:
 *   Resources default to "inherit" mode, deferring to the nearest ancestor
 *   container with an explicit policy. Container policies have an `inherit`
 *   flag (default true) — when false, children cannot inherit through them
 *   and must set their own policy. The root user container has no parent
 *   and cannot use inherit mode.
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

  // The root user container has no parent to inherit from
  const isRootContainer = resourceIri === `${config.baseUrl}/${username}/`;

  // Load current policy
  const policy = await loadPolicy(env.APPDATA, resourceIri);
  const friends = await loadFriends(env.APPDATA, username);

  // Resolve the effective policy when in inherit mode (or no policy set)
  let effectiveLabel = '';
  let effectiveSource = '';
  if (!isRootContainer && (policy.mode === 'inherit' || !policy.mode)) {
    const resolved = await resolveInheritedPolicy(env.APPDATA, resourceIri);
    if (resolved) {
      effectiveLabel = MODE_LABELS[resolved.policy.mode] || resolved.policy.mode;
      effectiveSource = resolved.source;
    } else {
      effectiveLabel = 'Private';
      effectiveSource = '(default)';
    }
  }

  const allModes = [
    ...(!isRootContainer ? [{ value: 'inherit', label: 'Inherit from parent', description: 'Use the same access policy as the parent container.' }] : []),
    { value: 'public', label: 'Public', description: 'Anyone can discover and read this resource.' },
    { value: 'unlisted', label: 'Public (unlisted)', description: 'Anyone with the direct link can read, but not listed in container indexes.' },
    { value: 'friends', label: 'Friends', description: 'Only people in your friends list can read.' },
    { value: 'private', label: 'Private', description: 'Only you can access this resource.' },
    { value: 'custom', label: 'Custom', description: 'Grant read access to specific WebIDs.' },
  ];

  const currentMode = policy.mode || (isRootContainer ? 'private' : 'inherit');
  const modeOptions = allModes.map(opt => ({
    ...opt,
    checked: currentMode === opt.value ? 'checked' : '',
    bgColor: currentMode === opt.value ? '#f0f0ff' : 'transparent',
  }));

  return renderPage('Access Policy', template, {
    resourceIri,
    isDir,
    path,
    modeOptions,
    customDisplay: currentMode === 'custom' ? 'block' : 'none',
    agentsText: (policy.agents || []).join('\n'),
    showInheritCheckbox: isDir && currentMode !== 'inherit',
    inheritChecked: policy.inherit !== false ? 'checked' : '',
    isInheritMode: currentMode === 'inherit',
    effectiveLabel,
    effectiveSource,
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

    if (mode === 'inherit') {
      // Store explicit inherit marker
      await env.APPDATA.put(`acp:${resourceIri}`, JSON.stringify({ mode: 'inherit' }));
    } else {
      const agentsRaw = form.get('agents') || '';
      const agents = agentsRaw.split('\n').map(a => a.trim()).filter(Boolean);
      const isDir = resourceIri.endsWith('/');
      const inherit = isDir ? form.get('inherit') === '1' : true;

      const policy = { mode, agents, inherit };
      await env.APPDATA.put(`acp:${resourceIri}`, JSON.stringify(policy));
    }
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

const DEFAULT_POLICY = { mode: 'inherit', agents: [], inherit: true };

const MODE_LABELS = {
  public: 'Public',
  unlisted: 'Public (unlisted)',
  friends: 'Friends',
  private: 'Private',
  custom: 'Custom',
  inherit: 'Inherit from parent',
};

async function loadPolicy(kv, resourceIri) {
  const data = await kv.get(`acp:${resourceIri}`);
  return data ? JSON.parse(data) : { ...DEFAULT_POLICY };
}

/**
 * Walk up from a resource to find the nearest ancestor with an explicit (non-inherit) policy.
 * Returns { policy, source } or null if nothing found.
 */
async function resolveInheritedPolicy(kv, resourceIri) {
  let uri = resourceIri;
  while (true) {
    const parsed = new URL(uri);
    const path = parsed.pathname;
    const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
    const lastSlash = trimmed.lastIndexOf('/');
    if (lastSlash <= 0) return null;
    uri = `${parsed.origin}${trimmed.slice(0, lastSlash + 1)}`;

    const data = await kv.get(`acp:${uri}`);
    if (!data) continue;

    const policy = JSON.parse(data);
    if (policy.inherit === false) {
      return { policy: { mode: 'private' }, source: uri + ' (inheritance blocked)' };
    }
    if (policy.mode === 'inherit') continue;
    return { policy, source: uri };
  }
}

async function loadFriends(kv, username) {
  const data = await kv.get(`friends:${username}`);
  return data ? JSON.parse(data) : [];
}

/**
 * Check if a resource is readable by a given agent based on ACP.
 * Walks up the container hierarchy looking for an applicable policy.
 *
 * Inheritance rules:
 *  - A resource with mode "inherit" (or no policy at all) defers to its parent.
 *  - A parent container with inherit: false blocks propagation — children that
 *    reach it during the walk get the default (private).
 *  - A parent container with inherit: true (or unset) applies its policy to children.
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

  // Check the resource's own policy first
  const ownData = await kv.get(`acp:${resourceIri}`);
  if (ownData) {
    const ownPolicy = JSON.parse(ownData);
    if (ownPolicy.mode !== 'inherit') {
      return evaluatePolicy(ownPolicy, agentWebId, kv, username);
    }
    // mode is "inherit" — fall through to parent walk
  }

  // Walk up the container hierarchy
  let uri = resourceIri;
  while (true) {
    const parsed = new URL(uri);
    const path = parsed.pathname;
    const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
    const lastSlash = trimmed.lastIndexOf('/');
    if (lastSlash <= 0) break;
    uri = `${parsed.origin}${trimmed.slice(0, lastSlash + 1)}`;

    const data = await kv.get(`acp:${uri}`);
    if (!data) continue;

    const policy = JSON.parse(data);
    // If this ancestor's policy doesn't propagate to children, stop
    if (policy.inherit === false) {
      return { readable: false, listed: false };
    }
    // Skip "inherit" policies — keep walking up
    if (policy.mode === 'inherit') continue;
    return evaluatePolicy(policy, agentWebId, kv, username);
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
  if (policy.mode === 'inherit') {
    return '# No explicit policy — inheriting from parent container.';
  }

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
