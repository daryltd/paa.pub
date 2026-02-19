/**
 * Login page.
 */
import { htmlPage, htmlResponse, escapeHtml } from '../shell.js';

export function renderLoginPage(reqCtx) {
  const error = reqCtx.error || '';
  const body = `
    <div class="card" style="max-width: 400px; margin: 4rem auto;">
      <h1>Login</h1>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
      <form method="POST" action="/login">
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" required autofocus>
        </div>
        <button type="submit" class="btn">Sign In</button>
      </form>
      <div id="passkey-login" style="margin-top: 1rem;">
        <button type="button" class="btn btn-secondary" onclick="passkeyLogin()" id="passkey-btn" style="display:none;">Sign in with Passkey</button>
      </div>
      <script>
        // Check if passkeys are available
        if (window.PublicKeyCredential) {
          document.getElementById('passkey-btn').style.display = 'inline-block';
        }
        async function passkeyLogin() {
          try {
            const beginRes = await fetch('/webauthn/login/begin', { method: 'POST' });
            if (!beginRes.ok) { alert('No passkeys registered'); return; }
            const options = await beginRes.json();
            options.challenge = base64ToBuffer(options.challenge);
            if (options.allowCredentials) {
              options.allowCredentials = options.allowCredentials.map(c => ({
                ...c, id: base64ToBuffer(c.id)
              }));
            }
            const cred = await navigator.credentials.get({ publicKey: options });
            const body = JSON.stringify({
              id: cred.id,
              rawId: bufferToBase64(cred.rawId),
              response: {
                authenticatorData: bufferToBase64(cred.response.authenticatorData),
                clientDataJSON: bufferToBase64(cred.response.clientDataJSON),
                signature: bufferToBase64(cred.response.signature),
              },
              type: cred.type,
            });
            const completeRes = await fetch('/webauthn/login/complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
            });
            if (completeRes.ok) { window.location.href = '/dashboard'; }
            else { alert('Passkey authentication failed'); }
          } catch (e) { console.error(e); alert('Passkey error: ' + e.message); }
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
  return htmlResponse(htmlPage('Login', body));
}
