/**
 * <paa-passkey> web component — passkey registration/management.
 * Note: Currently rendered inline in dashboard.js and login.js.
 */
export const passkeyFormTemplate = `
<template id="paa-passkey-template">
  <style>
    :host { display: block; }
    .btn { padding: 0.5rem 1rem; background: #1a1a2e; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
    .btn-secondary { background: #e0e0e0; color: #333; }
    .status { margin-top: 0.5rem; }
  </style>
  <div>
    <button class="btn btn-secondary" id="register-btn">Register Passkey</button>
    <div class="status" id="status"></div>
  </div>
</template>`;
