/**
 * Settings page — language/locale preferences and app management.
 *
 * Routes:
 *   GET  /settings — render settings page with language selector and app management
 *   POST /settings — handle preference saves, app permission updates/revokes
 *
 * User preferences are stored in APPDATA KV at key `user_prefs:{username}`.
 * App management functionality is migrated from the standalone app-permissions page.
 */
import { renderPage } from '../shell.js';
import template from '../templates/settings.html';
import { requireAuth } from '../../auth/middleware.js';
import { SUPPORTED_LANGUAGES } from '../../i18n/index.js';
import { formatDate } from '../../i18n/format.js';
import { listAppPermissions, revokeAppPermission, grantAppPermission, getAppPermission } from '../../solid/app-permissions.js';
import { parseNTriples, unwrapIri } from '../../rdf/ntriples.js';
import { PREFIXES } from '../../rdf/prefixes.js';

/**
 * GET /settings — render the settings page.
 */
export async function renderSettings(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env, storage, url, lang, dir, t, userPrefs } = reqCtx;
  const username = config.username;

  // Flash messages from redirect
  const saved = url.searchParams.get('saved');
  const success = saved === '1' ? (t.set_prefs_saved || 'Preferences saved.') : '';

  // Language selector data
  const currentLang = userPrefs?.language || lang;
  const languages = SUPPORTED_LANGUAGES.map(l => ({
    ...l,
    selected: l.code === currentLang,
  }));

  // Date format selector
  const currentDateFormat = userPrefs?.dateFormat || 'medium';
  const dateFormats = [
    { value: 'short', label: t.set_date_short || 'Short', selected: currentDateFormat === 'short' },
    { value: 'medium', label: t.set_date_medium || 'Medium', selected: currentDateFormat === 'medium' },
    { value: 'long', label: t.set_date_long || 'Long', selected: currentDateFormat === 'long' },
  ];

  // Load app permissions (migrated from app-permissions.js)
  const apps = await listAppPermissions(env.APPDATA, username);
  const containers = await loadTopLevelContainers(storage, config);
  const allContainers = containers.map(c => ({ iri: c.iri, path: c.path }));

  const appsData = apps.map(app => ({
    clientId: app.clientId,
    clientName: app.clientName || app.clientId,
    grantedAt: app.grantedAt ? formatDate(app.grantedAt, lang) : 'Unknown',
    containers: (app.allowedContainers || []).map(c => {
      const path = c.replace(config.baseUrl, '');
      return { iri: c, path };
    }),
    hasContainers: (app.allowedContainers || []).length > 0,
    allContainers,
    t,
  }));

  return renderPage('Settings', template, {
    apps: appsData,
    hasApps: appsData.length > 0,
    languages,
    dateFormats,
    success,
  }, { user: username, nav: 'settings', lang, dir, t, storage, baseUrl: config.baseUrl });
}

/**
 * POST /settings — handle preference saves and app permission updates.
 */
export async function handleSettingsUpdate(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { request, config, env } = reqCtx;
  const username = config.username;
  const form = await request.formData();
  const action = form.get('action');

  if (action === 'save_prefs') {
    const language = form.get('language') || 'en-US';
    const dateFormat = form.get('dateFormat') || 'medium';

    // Load existing prefs and merge
    const prefsRaw = await env.APPDATA.get(`user_prefs:${username}`);
    const prefs = prefsRaw ? JSON.parse(prefsRaw) : {};
    prefs.language = language;
    prefs.dateFormat = dateFormat;

    await env.APPDATA.put(`user_prefs:${username}`, JSON.stringify(prefs));

    return new Response(null, { status: 302, headers: { 'Location': '/settings?saved=1' } });
  }

  if (action === 'revoke') {
    const clientId = form.get('client_id');
    if (clientId) {
      await revokeAppPermission(env.APPDATA, username, clientId);
    }
  }

  if (action === 'update') {
    const clientId = form.get('client_id');
    if (clientId) {
      const existing = await getAppPermission(env.APPDATA, username, clientId);
      const clientName = existing?.clientName || '';
      const containers = form.getAll('containers');
      await grantAppPermission(env.APPDATA, username, clientId, clientName, containers);
    }
  }

  return new Response(null, { status: 302, headers: { 'Location': '/settings' } });
}

/**
 * Load top-level containers from the user's root container.
 */
async function loadTopLevelContainers(storage, config) {
  const rootIri = `${config.baseUrl}/${config.username}/`;
  const ntData = await storage.get(`doc:${rootIri}:${rootIri}`);
  if (!ntData) return [];

  const triples = parseNTriples(ntData);
  const ldpContains = PREFIXES.ldp + 'contains';
  const containers = [];

  for (const t of triples) {
    if (unwrapIri(t.predicate) === ldpContains) {
      const childIri = unwrapIri(t.object);
      if (childIri.endsWith('/')) {
        containers.push({
          iri: childIri,
          path: childIri.replace(config.baseUrl, ''),
        });
      }
    }
  }

  containers.sort((a, b) => a.path.localeCompare(b.path));
  return containers;
}
