/**
 * HTML page shell — the server-side rendering layer.
 *
 * All UI pages are rendered server-side using Mustache templates. The
 * rendering pipeline is:
 *
 *   1. Page handler prepares a data object with template variables
 *   2. `renderPage()` renders the body template with Mustache
 *   3. Navigation bar is rendered (if user is logged in)
 *   4. Body + nav + styles + dialog script are injected into layout.html
 *   5. Returns an HTML Response
 *
 * Template files (imported as strings by wrangler's text rules):
 *   - `templates/layout.html` — outer HTML shell (head, styles, body wrapper)
 *   - `templates/partials/nav.html` — navigation bar
 *   - `styles/base.css` — all CSS (inlined into each page)
 *   - `client/dialog.js` — accessible confirm/alert dialogs (inlined globally)
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
import baseStyles from './styles/base.css';
import dialogScript from './client/dialog.js';

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
 * @returns {Response}
 */
export function renderPage(title, bodyTemplate, data, opts = {}) {
  const nav = opts.user ? renderNav(opts.user, opts.nav) : '';
  const body = Mustache.render(bodyTemplate, data);
  const html = Mustache.render(layoutTemplate, { title, styles: baseStyles, nav, body, dialogScript });
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
 * @returns {string}
 */
export function htmlPage(title, body, opts = {}) {
  const nav = opts.user ? renderNav(opts.user, opts.nav) : '';
  return Mustache.render(layoutTemplate, { title, styles: baseStyles, nav, body, dialogScript });
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
      'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src * data:; connect-src 'self'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}
