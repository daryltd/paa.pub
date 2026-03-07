/**
 * App permissions POST handler.
 *
 * The GET page has been merged into /settings. This module only handles
 * POST /app-permissions for update/revoke form submissions.
 */
import { requireAuth } from '../../auth/middleware.js';
import { revokeAppPermission, grantAppPermission, getAppPermission, ACCESS_MODES } from '../../solid/app-permissions.js';

/**
 * POST /app-permissions — handle update/revoke actions.
 */
export async function handleAppPermissionsUpdate(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { request, config, env } = reqCtx;
  const username = reqCtx.user;
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
      const clientUri = existing?.clientUri || '';

      // Build a map of existing container modes for preservation
      const existingModes = new Map();
      for (const entry of (existing?.allowedContainers || [])) {
        existingModes.set(entry.iri, entry.modes || [...ACCESS_MODES]);
      }

      // Collect selected containers (settings page uses simple IRI checkboxes)
      const containerIris = form.getAll('containers');

      // Process manual container path
      const customContainer = (form.get('custom_container') || '').trim();
      if (customContainer) {
        let path = customContainer;
        if (!path.startsWith('/')) path = '/' + path;
        if (!path.endsWith('/')) path += '/';
        if (path.startsWith(`/${username}/`)) {
          const fullIri = config.baseUrl + path;
          if (!containerIris.includes(fullIri)) {
            containerIris.push(fullIri);
          }
        }
      }

      // Preserve existing modes for kept containers, grant all modes for new ones
      const allowedContainers = containerIris.map(iri => ({
        iri,
        modes: existingModes.get(iri) || [...ACCESS_MODES],
      }));

      await grantAppPermission(env.APPDATA, username, clientId, clientName, clientUri, allowedContainers);
    }
  }

  return new Response(null, { status: 302, headers: { 'Location': '/settings' } });
}
