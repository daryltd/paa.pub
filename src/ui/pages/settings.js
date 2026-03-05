/**
 * Settings page: language/locale, appearance, notifications, app management.
 *
 * Routes:
 *   GET  /settings — render settings page
 *   POST /settings — save user preferences
 */
import { renderPage } from '../shell.js';
import template from '../templates/settings.html';
import { requireAuth } from '../../auth/middleware.js';
import { SUPPORTED_LANGUAGES } from '../../i18n/index.js';
import { listAppPermissions } from '../../solid/app-permissions.js';
import { parseNTriples, unwrapIri } from '../../rdf/ntriples.js';
import { PREFIXES } from '../../rdf/prefixes.js';
import { formatDate } from '../../i18n/format.js';
import { getTranslations } from '../../i18n/index.js';

const TIMEZONES = [
  'UTC',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'America/Mexico_City',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'Asia/Jerusalem', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata',
  'Australia/Sydney',
  'Pacific/Auckland', 'Pacific/Honolulu',
];

/**
 * GET /settings — render the settings page.
 */
export async function renderSettings(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env, storage, lang } = reqCtx;
  const username = reqCtx.user;
  const t = getTranslations(lang);

  // Load user preferences
  const prefsRaw = await env.APPDATA.get(`user_prefs:${username}`);
  const prefs = prefsRaw ? JSON.parse(prefsRaw) : {};

  const message = reqCtx.url.searchParams.get('message') || '';

  // Build language options
  const languages = SUPPORTED_LANGUAGES.map(l => ({
    ...l,
    selected: (prefs.language || 'en-US') === l.code,
  }));

  // Build timezone options
  const currentTz = prefs.timezone || 'UTC';
  const timezones = TIMEZONES.map(tz => ({
    value: tz,
    label: tz.replace(/_/g, ' '),
    selected: tz === currentTz,
  }));

  // Date format selection
  const dateFormat = prefs.dateFormat || 'medium';

  // Notification prefs
  const showFollows = prefs.notifications?.showFollows !== false;
  const showMentions = prefs.notifications?.showMentions !== false;

  // App permissions data (same as app-permissions.js)
  const apps = await listAppPermissions(env.APPDATA, username);
  const containers = await loadTopLevelContainers(storage, config, username);

  const appsData = apps.map(app => {
    const allowedSet = new Set(app.allowedContainers || []);
    const allContainers = containers.map(c => ({
      iri: c.iri,
      path: c.path,
      checked: allowedSet.has(c.iri),
    }));

    let displayName = app.clientName || null;
    const clientUri = app.clientUri || '';
    if (!displayName && clientUri) {
      try { displayName = new URL(clientUri).hostname; } catch {}
    }
    if (!displayName) {
      try { displayName = new URL(app.clientId).hostname; } catch {}
    }
    if (!displayName) displayName = app.clientId;

    let displayOrigin = null;
    if (clientUri) {
      try { displayOrigin = new URL(clientUri).origin; } catch {}
    }
    if (!displayOrigin) {
      try { displayOrigin = new URL(app.clientId).origin; } catch {}
    }

    const isInternalClient = app.clientId.startsWith(config.baseUrl + '/clients/');

    return {
      clientId: app.clientId,
      clientName: app.clientName || '',
      clientUri,
      displayName,
      displayOrigin,
      isInternalClient,
      grantedAt: app.grantedAt ? formatDate(app.grantedAt, lang) : '',
      containers: (app.allowedContainers || []).map(c => ({
        iri: c,
        path: c.replace(config.baseUrl, ''),
      })),
      hasContainers: (app.allowedContainers || []).length > 0,
      allContainers,
      username,
    };
  });

  return renderPage('Settings', template, {
    message,
    languages,
    timezones,
    dateShort: dateFormat === 'short',
    dateMedium: dateFormat === 'medium',
    dateLong: dateFormat === 'long',
    themePath: prefs.theme || '',
    showFollows,
    showMentions,
    username,
    apps: appsData,
    hasApps: appsData.length > 0,
  }, { user: username, config, nav: 'settings', storage, baseUrl: config.baseUrl, lang });
}

/**
 * POST /settings — save user preferences.
 */
export async function handleSettingsUpdate(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { request, env, lang } = reqCtx;
  const t = getTranslations(lang);
  const username = reqCtx.user;
  const form = await request.formData();

  // Load existing prefs to merge
  const prefsRaw = await env.APPDATA.get(`user_prefs:${username}`);
  const prefs = prefsRaw ? JSON.parse(prefsRaw) : {};

  prefs.language = form.get('language') || 'en-US';
  prefs.dateFormat = form.get('dateFormat') || 'medium';
  prefs.timezone = form.get('timezone') || 'UTC';
  prefs.theme = form.get('themePath') || '';
  prefs.notifications = {
    showFollows: form.get('showFollows') === '1',
    showMentions: form.get('showMentions') === '1',
  };

  await env.APPDATA.put(`user_prefs:${username}`, JSON.stringify(prefs));

  const msg = t.settings_saved || 'Settings saved.';
  return new Response(null, {
    status: 302,
    headers: { 'Location': `/settings?message=${encodeURIComponent(msg)}` },
  });
}

/**
 * Load top-level containers from the user's root container.
 */
async function loadTopLevelContainers(storage, config, username) {
  const rootIri = `${config.baseUrl}/${username}/`;
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
