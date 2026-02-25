/**
 * Login page.
 */
import { renderPage } from '../shell.js';
import template from '../templates/login.html';

export function renderLoginPage(reqCtx) {
  const error = reqCtx.error || '';
  return renderPage('Login', template, { error });
}
