/**
 * HTML page shell with Mustache template rendering.
 */
import Mustache from 'mustache';
import layoutTemplate from './templates/layout.html';
import navPartial from './templates/partials/nav.html';
import baseStyles from './styles/base.css';

function renderNav(user, active) {
  return Mustache.render(navPartial, {
    user,
    items: [
      { href: '/dashboard', label: 'Dashboard', id: 'dashboard' },
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
  const html = Mustache.render(layoutTemplate, { title, styles: baseStyles, nav, body });
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
  return Mustache.render(layoutTemplate, { title, styles: baseStyles, nav, body });
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
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
