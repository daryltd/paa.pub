/**
 * Dashboard page.
 */
import { renderPage } from '../shell.js';
import template from '../templates/dashboard.html';
import webauthnUtils from '../client/webauthn-utils.js';
import passkeyRegisterScript from '../client/passkey-register.js';
import { requireAuth } from '../../auth/middleware.js';

export async function renderDashboard(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env } = reqCtx;
  const username = config.username;

  // Load stats
  const [followersData, followingData, outboxData, quotaData] = await Promise.all([
    env.APPDATA.get(`ap_followers:${username}`),
    env.APPDATA.get(`ap_following:${username}`),
    env.APPDATA.get(`ap_outbox_index:${username}`),
    env.APPDATA.get(`quota:${username}`),
  ]);

  const followers = JSON.parse(followersData || '[]');
  const following = JSON.parse(followingData || '[]');
  const outbox = JSON.parse(outboxData || '[]');
  const quota = JSON.parse(quotaData || '{"usedBytes":0}');

  // Load passkey list
  const credIds = JSON.parse(await env.APPDATA.get(`webauthn_creds:${username}`) || '[]');
  const passkeys = [];
  for (const id of credIds) {
    const data = await env.APPDATA.get(`webauthn_cred:${username}:${id}`);
    if (data) {
      const cred = JSON.parse(data);
      passkeys.push({ id, name: cred.name, createdAt: cred.createdAt });
    }
  }

  return renderPage('Dashboard', template, {
    username,
    webId: config.webId,
    actorId: config.actorId,
    domain: config.domain,
    followerCount: followers.length,
    followingCount: following.length,
    postCount: outbox.length,
    storageUsed: formatBytes(quota.usedBytes),
    webfingerParam: encodeURIComponent(username) + '@' + encodeURIComponent(config.domain),
    passkeys,
    hasPasskeys: passkeys.length > 0,
    clientScript: webauthnUtils + '\n' + passkeyRegisterScript,
  }, { user: username, nav: 'dashboard' });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
