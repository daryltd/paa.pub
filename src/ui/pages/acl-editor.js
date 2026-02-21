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
import { htmlPage, htmlResponse, escapeHtml } from '../shell.js';
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

  const body = `
    <h1>Access Policy</h1>

    <div class="card">
      <div class="text-muted" style="margin-bottom: 0.25rem;">
        Resource: <span class="mono">${escapeHtml(resourceIri)}</span>
      </div>
      ${isDir ? '<div class="text-muted" style="font-size: 0.8rem;">This policy applies to the container and its contents (unless overridden).</div>' : ''}
    </div>

    <div class="card">
      <h2>Access Level</h2>
      <form method="POST" action="/acp/${escapeHtml(path)}">
        <input type="hidden" name="action" value="save_policy">

        <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1rem;">
          ${radioOption('public', 'Public', 'Anyone can discover and read this resource.', policy.mode)}
          ${radioOption('unlisted', 'Public (unlisted)', 'Anyone with the direct link can read, but not listed in container indexes.', policy.mode)}
          ${radioOption('friends', 'Friends', 'Only people in your friends list can read.', policy.mode)}
          ${radioOption('private', 'Private', 'Only you can access this resource.', policy.mode)}
          ${radioOption('custom', 'Custom', 'Grant read access to specific WebIDs.', policy.mode)}
        </div>

        <div id="custom-agents" style="display: ${policy.mode === 'custom' ? 'block' : 'none'}; margin-bottom: 1rem;">
          <div class="form-group">
            <label for="agents">Allowed WebIDs (one per line)</label>
            <textarea id="agents" name="agents" rows="4" class="mono"
              style="font-size: 0.85rem;" placeholder="https://alice.example/profile/card#me">${escapeHtml((policy.agents || []).join('\n'))}</textarea>
          </div>
        </div>

        ${isDir ? `
          <div class="form-group">
            <label>
              <input type="checkbox" name="inherit" value="1" ${policy.inherit !== false ? 'checked' : ''}>
              Apply to all contents (children inherit this policy)
            </label>
          </div>
        ` : ''}

        <div style="display: flex; gap: 0.5rem;">
          <button type="submit" class="btn">Save Policy</button>
          <a href="/storage/${escapeHtml(path)}" class="btn btn-secondary">Back</a>
        </div>
      </form>

      <script>
        document.querySelectorAll('input[name="mode"]').forEach(r => {
          r.addEventListener('change', () => {
            document.getElementById('custom-agents').style.display =
              r.value === 'custom' ? 'block' : 'none';
          });
        });
      </script>
    </div>

    <div class="card">
      <h2>Friends List</h2>
      <p class="text-muted" style="margin-bottom: 0.75rem;">
        WebIDs listed here are granted read access when a resource is set to "Friends" mode.
      </p>
      ${friends.length > 0 ? `
        <table style="margin-bottom: 0.75rem;">
          ${friends.map(f => `
            <tr>
              <td class="mono" style="font-size: 0.85rem;">${escapeHtml(f)}</td>
              <td style="width: 3rem;">
                <form method="POST" action="/acp/${escapeHtml(path)}" class="inline">
                  <input type="hidden" name="action" value="remove_friend">
                  <input type="hidden" name="webid" value="${escapeHtml(f)}">
                  <button type="submit" class="text-muted"
                    style="background:none;border:none;cursor:pointer;font-size:0.8rem;color:#dc3545;padding:0;">remove</button>
                </form>
              </td>
            </tr>
          `).join('')}
        </table>
      ` : '<div class="text-muted" style="margin-bottom: 0.75rem;">No friends added yet.</div>'}

      <form method="POST" action="/acp/${escapeHtml(path)}">
        <input type="hidden" name="action" value="add_friend">
        <div style="display: flex; gap: 0.5rem;">
          <input type="url" name="webid" placeholder="https://alice.example/profile/card#me" required style="flex: 1;">
          <button type="submit" class="btn">Add Friend</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h2>ACP Details</h2>
      <details>
        <summary class="text-muted" style="cursor: pointer; font-size: 0.85rem;">View raw Access Control Policy (Turtle)</summary>
        <pre class="mono" style="font-size: 0.8rem; background: #f8f8f8; padding: 0.75rem; border-radius: 4px; margin-top: 0.5rem; overflow-x: auto; white-space: pre-wrap;">${escapeHtml(policyToTurtle(policy, resourceIri, config.webId, friends))}</pre>
      </details>
    </div>`;

  return htmlResponse(htmlPage('Access Policy', body, { user: username, nav: 'storage' }));
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

function radioOption(value, label, description, currentMode) {
  const checked = currentMode === value ? 'checked' : '';
  return `
    <label style="display: flex; gap: 0.75rem; align-items: flex-start; cursor: pointer; padding: 0.5rem; border-radius: 4px; background: ${currentMode === value ? '#f0f0ff' : 'transparent'};">
      <input type="radio" name="mode" value="${value}" ${checked} style="margin-top: 0.25rem;">
      <div>
        <div style="font-weight: 500;">${escapeHtml(label)}</div>
        <div class="text-muted" style="font-size: 0.8rem;">${escapeHtml(description)}</div>
      </div>
    </label>`;
}
