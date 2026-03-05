/**
 * Login page.
 */
import { renderPage } from '../shell.js';
import template from '../templates/login.html';

export async function renderLoginPage(reqCtx) {
  const error = reqCtx.error || '';
  const returnTo = reqCtx.returnTo || (reqCtx.url && reqCtx.url.searchParams.get('return_to')) || '';
  const fedcm = (reqCtx.url && reqCtx.url.searchParams.get('fedcm')) || '';

  // Fetch external IdP list (if env is available — not present when called from session.js error paths)
  let externalIdps = [];
  if (reqCtx.env && reqCtx.env.APPDATA) {
    const idpData = await reqCtx.env.APPDATA.get('fedcm_external_idps');
    if (idpData) externalIdps = JSON.parse(idpData);
  }

  const response = await renderPage('Login', template, {
    error,
    returnTo,
    fedcm,
    externalIdps,
    hasExternalIdps: externalIdps.length > 0,
  }, { lang: reqCtx.lang });

  // Extend CSP connect-src with external IdP origins so FedCM can reach them
  if (externalIdps.length > 0) {
    const origins = [...new Set(externalIdps.map(p => new URL(p.configURL).origin))];
    const csp = response.headers.get('Content-Security-Policy');
    const updated = csp.replace(
      /connect-src\s+'self'([^;]*)/,
      `connect-src 'self'$1 ${origins.join(' ')}`,
    );
    response.headers.set('Content-Security-Policy', updated);
  }

  return response;
}
