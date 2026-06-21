/**
 * Client-side FedCM login.
 * Feature-detects IdentityCredential and shows the FedCM sign-in button.
 * On click, triggers the browser-native account picker via navigator.credentials.get().
 */
(function () {
  if (!window.IdentityCredential) return;

  var btn = document.getElementById('fedcm-btn');
  if (btn) btn.classList.remove('hidden');
})();

// eslint-disable-next-line no-unused-vars
async function fedcmLogin() {
  try {
    var credential = await navigator.credentials.get({
      identity: {
        providers: [{
          configURL: location.origin + '/fedcm/config.json',
          clientId: location.origin,
        }],
      },
    });

    var res = await fetch('/fedcm/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: credential.token }),
    });

    if (res.ok) {
      window.location.href = '/dashboard';
    } else {
      var data = await res.json();
      alert('FedCM login failed: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      alert('FedCM login failed: ' + e.message);
    }
  }
}

// eslint-disable-next-line no-unused-vars
async function fedcmExternalLogin(configURL, clientId, idpId) {
  try {
    var credential = await navigator.credentials.get({
      identity: {
        providers: [{ configURL: configURL, clientId: clientId }],
      },
    });

    var res = await fetch('/fedcm/external-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: credential.token, idpId: idpId }),
    });

    var data = await res.json();
    if (data.success) {
      window.location.href = '/dashboard';
    } else if (data.needsRegistration) {
      window.location.href = '/signup/fedcm?token=' + encodeURIComponent(data.registrationToken);
    } else {
      alert('Login failed: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      alert('FedCM login failed: ' + e.message);
    }
  }
}
