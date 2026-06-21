if (window.PublicKeyCredential) {
  document.getElementById('passkey-btn').classList.remove('hidden');
}
async function passkeyLogin() {
  try {
    var usernameInput = document.getElementById('username');
    var username = usernameInput ? usernameInput.value.trim() : '';
    if (!username) { await paaAlert('Please enter your username first'); return; }
    var beginRes = await fetch('/webauthn/login/begin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username }),
    });
    if (!beginRes.ok) { await paaAlert('No passkeys registered for this user'); return; }
    var options = await beginRes.json();
    options.challenge = base64ToBuffer(options.challenge);
    if (options.allowCredentials) {
      options.allowCredentials = options.allowCredentials.map(function(c) {
        return Object.assign({}, c, { id: base64ToBuffer(c.id) });
      });
    }
    var cred = await navigator.credentials.get({ publicKey: options });
    var body = JSON.stringify({
      id: cred.id,
      rawId: bufferToBase64(cred.rawId),
      response: {
        authenticatorData: bufferToBase64(cred.response.authenticatorData),
        clientDataJSON: bufferToBase64(cred.response.clientDataJSON),
        signature: bufferToBase64(cred.response.signature),
      },
      type: cred.type,
    });
    var completeRes = await fetch('/webauthn/login/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    });
    if (completeRes.ok) { window.location.href = '/dashboard'; }
    else { await paaAlert('Passkey authentication failed'); }
  } catch (e) { console.error(e); await paaAlert('Passkey error: ' + e.message); }
}
