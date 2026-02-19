/**
 * Dashboard page.
 */
import { htmlPage, htmlResponse, escapeHtml } from '../shell.js';
import { requireAuth } from '../../auth/middleware.js';

export async function renderDashboard(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env } = reqCtx;
  const username = config.username;

  // Load stats
  const [followersData, followingData, outboxData, quotaData] = await Promise.all([
    env.APPDATA.get(`ap_followers:${username}`),
    env.APPDATA.get(`ap_following:${username}`),
    env.APPDATA.get(`ap_outbox_index:${username}`),
    env.APPDATA.get(`quota:${username}`),
  ]);

  const followers = JSON.parse(followersData || '[]');
  const following = JSON.parse(followingData || '[]');
  const outbox = JSON.parse(outboxData || '[]');
  const quota = JSON.parse(quotaData || '{"usedBytes":0}');

  const body = `
    <h1>Dashboard</h1>

    <div class="card">
      <h2>Profile</h2>
      <table>
        <tr><td>Username</td><td class="mono">${escapeHtml(username)}</td></tr>
        <tr><td>WebID</td><td class="mono"><a href="/${username}/profile/card">${escapeHtml(config.webId)}</a></td></tr>
        <tr><td>Actor</td><td class="mono"><a href="/${username}/profile/card">${escapeHtml(config.actorId)}</a></td></tr>
        <tr><td>Domain</td><td class="mono">${escapeHtml(config.domain)}</td></tr>
      </table>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
      <div class="card">
        <div class="text-muted">Followers</div>
        <div style="font-size: 2rem; font-weight: 700;">${followers.length}</div>
      </div>
      <div class="card">
        <div class="text-muted">Following</div>
        <div style="font-size: 2rem; font-weight: 700;">${following.length}</div>
      </div>
      <div class="card">
        <div class="text-muted">Posts</div>
        <div style="font-size: 2rem; font-weight: 700;">${outbox.length}</div>
      </div>
      <div class="card">
        <div class="text-muted">Storage Used</div>
        <div style="font-size: 2rem; font-weight: 700;">${formatBytes(quota.usedBytes)}</div>
      </div>
    </div>

    <div class="card">
      <h2>Quick Links</h2>
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
        <a href="/activity" class="btn">Activity Feed</a>
        <a href="/storage/" class="btn btn-secondary">File Storage</a>
        <a href="/.well-known/webfinger?resource=acct:${encodeURIComponent(username)}@${encodeURIComponent(config.domain)}" class="btn btn-secondary">WebFinger</a>
      </div>
    </div>

    <div class="card">
      <h2>Passkeys</h2>
      <div id="passkey-section">
        <button class="btn btn-secondary" onclick="beginRegisterPasskey()">Register Passkey</button>
        <div id="passkey-status" style="margin-top: 0.5rem;"></div>
      </div>
      <script>
        async function beginRegisterPasskey() {
          const status = document.getElementById('passkey-status');
          try {
            const beginRes = await fetch('/webauthn/register/begin', { method: 'POST' });
            if (!beginRes.ok) { status.textContent = 'Error: ' + await beginRes.text(); return; }
            const options = await beginRes.json();
            options.challenge = base64ToBuffer(options.challenge);
            options.user.id = base64ToBuffer(options.user.id);
            const cred = await navigator.credentials.create({ publicKey: options });
            const body = JSON.stringify({
              id: cred.id,
              rawId: bufferToBase64(cred.rawId),
              response: {
                attestationObject: bufferToBase64(cred.response.attestationObject),
                clientDataJSON: bufferToBase64(cred.response.clientDataJSON),
              },
              type: cred.type,
            });
            const completeRes = await fetch('/webauthn/register/complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
            });
            if (completeRes.ok) { status.innerHTML = '<span class="success">Passkey registered!</span>'; }
            else { status.textContent = 'Registration failed: ' + await completeRes.text(); }
          } catch (e) { status.textContent = 'Error: ' + e.message; }
        }
        function base64ToBuffer(b64) {
          const s = atob(b64.replace(/-/g,'+').replace(/_/g,'/'));
          return Uint8Array.from(s, c => c.charCodeAt(0)).buffer;
        }
        function bufferToBase64(buf) {
          return btoa(String.fromCharCode(...new Uint8Array(buf)))
            .replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
        }
      </script>
    </div>`;

  return htmlResponse(htmlPage('Dashboard', body, { user: username, nav: 'dashboard' }));
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
