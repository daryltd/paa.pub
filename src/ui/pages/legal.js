/**
 * Static legal pages: privacy policy and terms of service.
 *
 * Routes:
 *   GET /privacy
 *   GET /terms
 */
import { renderPage } from '../shell.js';
import { loadHtml } from '../../html-loader.js';
const privacyTemplate = await loadHtml(import.meta.url, '../templates/privacy.html', () => import('../templates/privacy.html'));
const termsTemplate = await loadHtml(import.meta.url, '../templates/terms.html', () => import('../templates/terms.html'));

/**
 * GET /privacy
 */
export async function renderPrivacyPage(reqCtx) {
  const { config, lang } = reqCtx;
  return renderPage('Privacy Policy', privacyTemplate, {
    domain: config.domain,
    baseUrl: config.baseUrl,
    adminProfileUrl: `${config.baseUrl}/${config.adminUsername}/profile/card`,
  }, { lang, request: reqCtx.request });
}

/**
 * GET /terms
 */
export async function renderTermsPage(reqCtx) {
  const { config, lang } = reqCtx;
  return renderPage('Terms of Service', termsTemplate, {
    domain: config.domain,
    baseUrl: config.baseUrl,
    adminProfileUrl: `${config.baseUrl}/${config.adminUsername}/profile/card`,
  }, { lang, request: reqCtx.request });
}
