/**
 * App permissions management page.
 *
 * Routes:
 *   GET  /app-permissions — list authorized apps with their granted containers
 *   POST /app-permissions — update container access or revoke apps
 */
import { renderPage } from '../shell.js';
import template from '../templates/app-permissions.html';
import { requireAuth } from '../../auth/middleware.js';
import { listAppPermissions, revokeAppPermission, grantAppPermission, getAppPermission } from '../../solid/app-permissions.js';
import { parseNTriples, unwrapIri } from '../../rdf/ntriples.js';
import { PREFIXES } from '../../rdf/prefixes.js';

/**
 * GET /app-permissions — render the management page.
 */
export async function renderAppPermissions(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env, storage } = reqCtx;
  const username = config.username;

  const apps = await listAppPermissions(env.APPDATA, username);

  // Load available containers for the update form
  const containers = await loadTopLevelContainers(storage, config);

  const allContainers = containers.map(c => ({ iri: c.iri, path: c.path }));

  const appsData = apps.map(app => ({
    clientId: app.clientId,
    clientName: app.clientName || app.clientId,
    grantedAt: app.grantedAt ? new Date(app.grantedAt).toLocaleDateString() : 'Unknown',
    containers: (app.allowedContainers || []).map(c => {
      const path = c.replace(config.baseUrl, '');
      return { iri: c, path };
    }),
    hasContainers: (app.allowedContainers || []).length > 0,
    allContainers,
  }));

  return renderPage('App Permissions', template, {
    apps: appsData,
    hasApps: appsData.length > 0,
  }, { user: username, nav: 'storage' });
}

/**
 * POST /app-permissions — handle update/revoke actions.
 */
export async function handleAppPermissionsUpdate(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { request, config, env } = reqCtx;
  const username = config.username;
  const form = await request.formData();
  const action = form.get('action');

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
      // Collect selected containers
      const containers = form.getAll('containers');
      await grantAppPermission(env.APPDATA, username, clientId, clientName, containers);
    }
  }

  return new Response(null, { status: 302, headers: { 'Location': '/app-permissions' } });
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
