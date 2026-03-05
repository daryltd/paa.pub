/**
 * Admin dashboard: aggregate stats and per-user overview.
 */
import { requireAdmin } from './middleware.js';
import { listUsers } from '../users.js';
import { renderPage } from '../ui/shell.js';
import template from '../ui/templates/admin-dashboard.html';
import { formatBytes } from '../i18n/format.js';

/**
 * GET /admin — admin dashboard.
 */
export async function renderAdminDashboard(reqCtx) {
  const authCheck = requireAdmin(reqCtx);
  if (authCheck) return authCheck;

  const { env, config } = reqCtx;
  const userList = await listUsers(env.APPDATA);

  let totalStorage = 0;
  let totalPosts = 0;

  const users = await Promise.all(userList.map(async (u) => {
    const quotaData = await env.APPDATA.get(`quota:${u.username}`);
    const storageBytes = quotaData ? (JSON.parse(quotaData).usedBytes || 0) : 0;
    totalStorage += storageBytes;

    const followersData = await env.APPDATA.get(`ap_followers:${u.username}`);
    const followersCount = followersData ? JSON.parse(followersData).length : 0;

    const outboxData = await env.APPDATA.get(`ap_outbox_index:${u.username}`);
    const postsCount = outboxData ? JSON.parse(outboxData).length : 0;
    totalPosts += postsCount;

    return {
      username: u.username,
      isAdmin: u.isAdmin,
      disabled: u.disabled,
      storageDisplay: formatBytes(storageBytes),
      followersCount,
      postsCount,
      createdShort: u.createdAt ? u.createdAt.split('T')[0] : '',
    };
  }));

  const idps = JSON.parse(await env.APPDATA.get('fedcm_external_idps') || '[]');

  return renderPage('Admin Dashboard', template, {
    totalUsers: userList.length,
    totalStorage: formatBytes(totalStorage),
    totalPosts,
    users,
    idps,
    hasIdps: idps.length > 0,
  }, { user: reqCtx.user, nav: 'admin', config, lang: reqCtx.lang });
}
