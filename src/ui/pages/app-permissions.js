/**
 * App permissions POST handler.
 *
 * The GET page has been merged into /settings. This module only handles
 * POST /app-permissions for update/revoke form submissions.
 */
import { requireAuth } from '../../auth/middleware.js';
import { revokeAppPermission, grantAppPermission, getAppPermission } from '../../solid/app-permissions.js';

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
      // Collect selected containers
      const containers = form.getAll('containers');

      // Process manual container path
      const customContainer = (form.get('custom_container') || '').trim();
      if (customContainer) {
        let path = customContainer;
        if (!path.startsWith('/')) path = '/' + path;
        if (!path.endsWith('/')) path += '/';
        if (path.startsWith(`/${username}/`)) {
          const fullIri = config.baseUrl + path;
          if (!containers.includes(fullIri)) {
            containers.push(fullIri);
          }
        }
      }

      await grantAppPermission(env.APPDATA, username, clientId, clientName, clientUri, containers);
    }
  }

  return new Response(null, { status: 302, headers: { 'Location': '/settings' } });
}
