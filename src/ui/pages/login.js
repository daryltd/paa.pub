/**
 * Login page.
 */
import { renderPage } from '../shell.js';
import template from '../templates/login.html';

export function renderLoginPage(reqCtx) {
  const error = reqCtx.error || '';
  const returnTo = reqCtx.returnTo || (reqCtx.url && reqCtx.url.searchParams.get('return_to')) || '';
  return renderPage('Login', template, { error, returnTo });
}
