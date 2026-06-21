/**
 * Admin user management.
 */
import { requireAdmin } from './middleware.js';
import { listUsers, getUser, disableUser, enableUser, setUserQuota, createUser, userExists } from '../users.js';
import { getUserStorageLimit } from '../users.js';
import { hashPassword } from '../auth/password.js';
import { bootstrapUser } from '../bootstrap.js';
import { RESERVED_NAMES } from '../config.js';
import { renderPage } from '../ui/shell.js';
import template from '../ui/templates/admin-users.html';
import { formatBytes } from '../i18n/format.js';
import { getTranslations } from '../i18n/index.js';

/**
 * GET /admin/users — user management list.
 */
export async function renderAdminUsers(reqCtx) {
  const authCheck = requireAdmin(reqCtx);
  if (authCheck) return authCheck;

  const { env, config } = reqCtx;
  const message = reqCtx.url.searchParams.get('message') || '';
  const error = reqCtx.url.searchParams.get('error') || '';

  const data = await buildUserListData(env, config);
  data.message = message;
  data.error = error;
  data.registrationClosed = config.registrationMode === 'closed';

  return renderPage('User Management', template, data, { user: reqCtx.user, nav: 'admin', config, lang: reqCtx.lang });
}

/**
 * POST /admin/users — handle user management actions.
 */
export async function handleAdminUserAction(reqCtx) {
  const authCheck = requireAdmin(reqCtx);
  if (authCheck) return authCheck;

  const { request, env, config, lang } = reqCtx;
  const t = getTranslations(lang);
  const form = await request.formData();
  const action = form.get('action');
  const username = form.get('username') || '';

  switch (action) {
    case 'disable': {
      if (username && username !== config.adminUsername) {
        await disableUser(env.APPDATA, username);
        const msg = (t.msg_user_disabled || '').replace('{{username}}', username);
        return redirect(`/admin/users?message=${encodeURIComponent(msg)}`);
      }
      return redirect(`/admin/users?error=${encodeURIComponent(t.err_cannot_disable_admin)}`);
    }
    case 'enable': {
      if (username) {
        await enableUser(env.APPDATA, username);
        const msg = (t.msg_user_enabled || '').replace('{{username}}', username);
        return redirect(`/admin/users?message=${encodeURIComponent(msg)}`);
      }
      return redirect('/admin/users');
    }
    case 'set_quota': {
      const quotaMb = parseInt(form.get('quota_mb') || '0', 10);
      if (username && quotaMb >= 0) {
        await setUserQuota(env.APPDATA, username, quotaMb * 1024 * 1024);
        const msg = (t.msg_quota_set || '').replace('{{username}}', username);
        return redirect(`/admin/users?message=${encodeURIComponent(msg)}`);
      }
      return redirect('/admin/users');
    }
    case 'create_user': {
      const newUsername = (form.get('new_username') || '').trim().toLowerCase();
      const newPassword = form.get('new_password') || '';

      if (!newUsername || !/^[a-zA-Z0-9_-]+$/.test(newUsername)) {
        return redirect(`/admin/users?error=${encodeURIComponent(t.err_invalid_username)}`);
      }
      if (RESERVED_NAMES.has(newUsername)) {
        return redirect(`/admin/users?error=${encodeURIComponent(t.err_reserved_username)}`);
      }
      if (await userExists(env.APPDATA, newUsername)) {
        return redirect(`/admin/users?error=${encodeURIComponent(t.err_already_taken)}`);
      }
      if (newPassword.length < 8) {
        return redirect(`/admin/users?error=${encodeURIComponent(t.err_password_short)}`);
      }

      const passwordHash = await hashPassword(newPassword);
      await createUser(env.APPDATA, newUsername, passwordHash);
      await bootstrapUser(env, config, newUsername, reqCtx.storage);

      const msg = (t.msg_user_created || '').replace('{{username}}', newUsername);
      return redirect(`/admin/users?message=${encodeURIComponent(msg)}`);
    }
    default:
      return redirect('/admin/users');
  }
}

async function buildUserListData(env, config) {
  const userList = await listUsers(env.APPDATA);

  const users = await Promise.all(userList.map(async (u) => {
    const quotaData = await env.APPDATA.get(`quota:${u.username}`);
    const storageBytes = quotaData ? (JSON.parse(quotaData).usedBytes || 0) : 0;

    const userStorageLimit = await getUserStorageLimit(env.APPDATA, u.username, config.storageLimit);
    const quotaMb = Math.round(userStorageLimit / (1024 * 1024));

    return {
      username: u.username,
      isAdmin: u.isAdmin,
      disabled: u.disabled,
      storageDisplay: formatBytes(storageBytes),
      quotaDisplay: formatBytes(userStorageLimit),
      quotaMb,
    };
  }));

  return { users };
}

function redirect(location) {
  return new Response(null, { status: 302, headers: { 'Location': location } });
}
