async function beginRegisterPasskey() {
  var status = document.getElementById('passkey-status');
  try {
    var beginRes = await fetch('/webauthn/register/begin', { method: 'POST' });
    if (!beginRes.ok) { status.textContent = 'Error: ' + await beginRes.text(); return; }
    var options = await beginRes.json();
    options.challenge = base64ToBuffer(options.challenge);
    options.user.id = base64ToBuffer(options.user.id);
    if (options.excludeCredentials) {
      options.excludeCredentials = options.excludeCredentials.map(function(c) {
        return Object.assign({}, c, { id: base64ToBuffer(c.id) });
      });
    }
    var cred = await navigator.credentials.create({ publicKey: options });
    var body = JSON.stringify({
      id: cred.id,
      rawId: bufferToBase64(cred.rawId),
      response: {
        attestationObject: bufferToBase64(cred.response.attestationObject),
        clientDataJSON: bufferToBase64(cred.response.clientDataJSON),
      },
      type: cred.type,
    });
    var completeRes = await fetch('/webauthn/register/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    });
    if (completeRes.ok) { window.location.reload(); return; }
    else { status.textContent = 'Registration failed: ' + await completeRes.text(); }
  } catch (e) { status.textContent = 'Error: ' + e.message; }
}
