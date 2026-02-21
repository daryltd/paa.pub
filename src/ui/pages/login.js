/**
 * Login page.
 */
import { renderPage } from '../shell.js';
import template from '../templates/login.html';
import webauthnUtils from '../client/webauthn-utils.js';
import passkeyLoginScript from '../client/passkey-login.js';

export function renderLoginPage(reqCtx) {
  const error = reqCtx.error || '';
  return renderPage('Login', template, {
    error,
    clientScript: webauthnUtils + '\n' + passkeyLoginScript,
  });
}
