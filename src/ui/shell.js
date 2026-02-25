/**
 * HTML page shell — the server-side rendering layer.
 *
 * All UI pages are rendered server-side using Mustache templates. The
 * rendering pipeline is:
 *
 *   1. Page handler prepares a data object with template variables
 *   2. `renderPage()` renders the body template with Mustache
 *   3. Navigation bar is rendered (if user is logged in)
 *   4. Body + nav are injected into layout.html
 *   5. Returns an HTML Response
 *
 * CSS and client-side JS are served as linked files via the static
 * handler (see `static.js`), not inlined into the HTML.
 *
 * Template files (imported as strings by wrangler's text rules):
 *   - `templates/layout.html` — outer HTML shell (head, linked CSS/JS, body wrapper)
 *   - `templates/partials/nav.html` — navigation bar
 *
 * Mustache syntax used in templates:
 *   - `{{var}}` — HTML-escaped variable
 *   - `{{{var}}}` — unescaped (for pre-rendered HTML, styles, scripts)
 *   - `{{#flag}}...{{/flag}}` — conditional section
 *   - `{{^flag}}...{{/flag}}` — inverted section (render if falsy)
 *   - `{{#array}}...{{/array}}` — iteration
 */
import Mustache from 'mustache';
import layoutTemplate from './templates/layout.html';
import navPartial from './templates/partials/nav.html';

function renderNav(user, active) {
  return Mustache.render(navPartial, {
    user,
    username: user,
    items: [
      { href: '/dashboard', label: 'Dashboard', id: 'dashboard' },
      { href: '/profile', label: 'Profile', id: 'profile' },
      { href: '/activity', label: 'Activity', id: 'activity' },
      { href: '/storage/', label: 'Storage', id: 'storage' },
    ].map(i => ({ ...i, activeClass: active === i.id ? 'active' : '' })),
  });
}

/**
 * Render a full HTML page using Mustache templates.
 * @param {string} title - page title
 * @param {string} bodyTemplate - Mustache template string for the body
 * @param {object} data - data passed to the body template
 * @param {object} [opts]
 * @param {string} [opts.user] - logged-in username (shows nav if set)
 * @param {string} [opts.nav] - active nav item id
 * @param {object} [opts.storage] - CloudflareAdapter for custom theme check
 * @param {string} [opts.baseUrl] - server base URL for custom theme check
 * @returns {Promise<Response>}
 */
export async function renderPage(title, bodyTemplate, data, opts = {}) {
  const nav = opts.user ? renderNav(opts.user, opts.nav) : '';
  const body = Mustache.render(bodyTemplate, data);
  const customThemeHref = await resolveCustomTheme(opts);
  const html = Mustache.render(layoutTemplate, { title, nav, body, customThemeHref });
  return htmlResponse(html);
}

/**
 * Render a partial template with data.
 * @param {string} template - Mustache template string
 * @param {object} data
 * @returns {string}
 */
export function renderPartial(template, data) {
  return Mustache.render(template, data);
}

/**
 * Wrap pre-built body HTML in the layout shell.
 * Used by oidc.js which builds its body with template literals.
 * @param {string} title
 * @param {string} body - pre-rendered HTML body content
 * @param {object} [opts]
 * @returns {Promise<string>|string}
 */
export async function htmlPage(title, body, opts = {}) {
  const nav = opts.user ? renderNav(opts.user, opts.nav) : '';
  const customThemeHref = await resolveCustomTheme(opts);
  return Mustache.render(layoutTemplate, { title, nav, body, customThemeHref });
}

/**
 * Check if a custom theme CSS file exists in the user's storage.
 * Returns the href if found, empty string otherwise.
 */
async function resolveCustomTheme(opts) {
  if (!opts.user || !opts.storage || !opts.baseUrl) return '';
  const themeIri = `${opts.baseUrl}/${opts.user}/paa_custom/theme.css`;
  const idx = await opts.storage.get(`idx:${themeIri}`);
  if (!idx) return '';
  return `/${opts.user}/paa_custom/theme.css`;
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; img-src * data:; connect-src 'self' https://www.ebi.ac.uk",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}
