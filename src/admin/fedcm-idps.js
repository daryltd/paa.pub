/**
 * Admin page for managing external FedCM identity providers.
 */
import { requireAdmin } from './middleware.js';
import { renderPage } from '../ui/shell.js';
import template from '../ui/templates/admin-fedcm-idps.html';

/**
 * Read the external IdP list from KV.
 * @param {KVNamespace} kv
 * @returns {Promise<Array>}
 */
async function getIdpList(kv) {
  const data = await kv.get('fedcm_external_idps');
  return data ? JSON.parse(data) : [];
}

/**
 * Write the external IdP list to KV.
 * @param {KVNamespace} kv
 * @param {Array} idps
 */
async function setIdpList(kv, idps) {
  await kv.put('fedcm_external_idps', JSON.stringify(idps));
}

/**
 * GET /admin/fedcm-idps — list external IdPs with add form.
 */
export async function renderAdminFedCMIdps(reqCtx) {
  const authCheck = requireAdmin(reqCtx);
  if (authCheck) return authCheck;

  const { env } = reqCtx;
  const message = reqCtx.url.searchParams.get('message') || '';
  const error = reqCtx.url.searchParams.get('error') || '';

  const idps = await getIdpList(env.APPDATA);

  return renderPage('External FedCM IdPs', template, {
    idps,
    hasIdps: idps.length > 0,
    message,
    error,
  }, { user: reqCtx.user, nav: 'admin', config: reqCtx.config, lang: reqCtx.lang });
}

/**
 * POST /admin/fedcm-idps — add or remove an external IdP.
 */
export async function handleAdminFedCMIdpAction(reqCtx) {
  const authCheck = requireAdmin(reqCtx);
  if (authCheck) return authCheck;

  const { request, env } = reqCtx;
  const form = await request.formData();
  const action = form.get('action');

  switch (action) {
    case 'add': {
      const id = (form.get('id') || '').trim().toLowerCase();
      const name = (form.get('name') || '').trim();
      const configURL = (form.get('configURL') || '').trim();
      const clientId = (form.get('clientId') || '').trim();
      const issuer = (form.get('issuer') || '').trim();

      if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
        return redirect('/admin/fedcm-idps?error=Invalid ID (letters, numbers, hyphens, underscores only)');
      }
      if (!name) {
        return redirect('/admin/fedcm-idps?error=Name is required');
      }
      if (!configURL || !configURL.startsWith('https://')) {
        return redirect('/admin/fedcm-idps?error=Config URL must be a valid HTTPS URL');
      }
      if (!clientId) {
        return redirect('/admin/fedcm-idps?error=Client ID is required');
      }

      const idps = await getIdpList(env.APPDATA);
      if (idps.some(p => p.id === id)) {
        return redirect('/admin/fedcm-idps?error=An IdP with that ID already exists');
      }

      idps.push({
        id,
        name,
        configURL,
        clientId,
        issuer: issuer || new URL(configURL).origin,
      });
      await setIdpList(env.APPDATA, idps);

      return redirect(`/admin/fedcm-idps?message=Added ${name}`);
    }
    case 'edit': {
      const id = form.get('id') || '';
      const name = (form.get('name') || '').trim();
      const configURL = (form.get('configURL') || '').trim();
      const clientId = (form.get('clientId') || '').trim();
      const issuer = (form.get('issuer') || '').trim();

      if (!name) {
        return redirect('/admin/fedcm-idps?error=Name is required');
      }
      if (!configURL || !configURL.startsWith('https://')) {
        return redirect('/admin/fedcm-idps?error=Config URL must be a valid HTTPS URL');
      }
      if (!clientId) {
        return redirect('/admin/fedcm-idps?error=Client ID is required');
      }

      const idps = await getIdpList(env.APPDATA);
      const entry = idps.find(p => p.id === id);
      if (!entry) {
        return redirect('/admin/fedcm-idps?error=Provider not found');
      }

      entry.name = name;
      entry.configURL = configURL;
      entry.clientId = clientId;
      entry.issuer = issuer || new URL(configURL).origin;
      await setIdpList(env.APPDATA, idps);

      return redirect(`/admin/fedcm-idps?message=Updated ${name}`);
    }
    case 'remove': {
      const id = form.get('id') || '';
      const idps = await getIdpList(env.APPDATA);
      const updated = idps.filter(p => p.id !== id);
      await setIdpList(env.APPDATA, updated);
      return redirect('/admin/fedcm-idps?message=Provider removed');
    }
    default:
      return redirect('/admin/fedcm-idps');
  }
}

function redirect(location) {
  return new Response(null, { status: 302, headers: { 'Location': location } });
}
