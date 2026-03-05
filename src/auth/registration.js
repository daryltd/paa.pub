/**
 * User registration: GET/POST /signup and FedCM signup flow.
 */
import { renderPage } from '../ui/shell.js';
import { hashPassword } from './password.js';
import { createSession } from './session.js';
import { createUser, userExists, getUser } from '../users.js';
import { bootstrapUser } from '../bootstrap.js';
import { RESERVED_NAMES } from '../config.js';
import { getTranslations } from '../i18n/index.js';
import template from '../ui/templates/signup.html';
import fedcmTemplate from '../ui/templates/signup-fedcm.html';

/**
 * GET /signup — render the registration form.
 */
export function renderSignupPage(reqCtx) {
  const { config, lang } = reqCtx;
  const t = getTranslations(lang);
  if (config.registrationMode === 'closed') {
    return new Response(t.err_registration_closed, { status: 403 });
  }
  const error = reqCtx.url.searchParams.get('error') || '';
  return renderPage('Sign Up', template, { error, username: '' }, { lang });
}

/**
 * POST /signup — process registration.
 */
export async function handleSignup(reqCtx) {
  const { request, config, env, lang } = reqCtx;
  const t = getTranslations(lang);

  if (config.registrationMode === 'closed') {
    return new Response(t.err_registration_closed, { status: 403 });
  }

  const form = await request.formData();
  const username = (form.get('username') || '').trim().toLowerCase();
  const password = form.get('password') || '';
  const confirmPassword = form.get('confirm_password') || '';

  // Validate username
  if (!username || !/^[a-zA-Z0-9_-]+$/.test(username)) {
    return renderPage('Sign Up', template, {
      error: t.err_username_invalid,
      username,
    }, { lang });
  }
  if (RESERVED_NAMES.has(username)) {
    return renderPage('Sign Up', template, {
      error: t.err_username_reserved,
      username,
    }, { lang });
  }
  if (await userExists(env.APPDATA, username)) {
    return renderPage('Sign Up', template, {
      error: t.err_username_taken,
      username,
    }, { lang });
  }

  // Validate password
  if (password.length < 8) {
    return renderPage('Sign Up', template, {
      error: t.err_password_short,
      username,
    }, { lang });
  }
  if (password !== confirmPassword) {
    return renderPage('Sign Up', template, {
      error: t.err_password_mismatch,
      username,
    }, { lang });
  }

  // Create the user
  const passwordHash = await hashPassword(password);
  await createUser(env.APPDATA, username, passwordHash);

  // Bootstrap user pod (containers, keypair, WebID profile, ACLs, TypeIndex)
  await bootstrapUser(env, config, username, reqCtx.storage);

  // Auto-login: create session and redirect to dashboard
  const token = await createSession(env.APPDATA, username);
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/dashboard',
      'Set-Cookie': `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${config.protocol === 'https' ? '; Secure' : ''}`,
      'Set-Login': 'logged-in',
    },
  });
}

// ── FedCM Registration Flow ──────────────────────────

/**
 * GET /signup/fedcm?token=... — render FedCM registration form.
 */
export async function renderFedCMSignupPage(reqCtx) {
  const { env, lang } = reqCtx;
  const t = getTranslations(lang);
  const token = reqCtx.url.searchParams.get('token') || '';

  if (!token) {
    return new Response(t.err_missing_token, { status: 400 });
  }

  const pendingData = await env.APPDATA.get(`fedcm_pending:${token}`);
  if (!pendingData) {
    return new Response(t.err_token_expired, { status: 400 });
  }

  const pending = JSON.parse(pendingData);

  // Resolve IdP display name
  const idpList = JSON.parse(await env.APPDATA.get('fedcm_external_idps') || '[]');
  const idp = idpList.find(p => p.id === pending.idpId);
  const idpName = idp ? idp.name : pending.idpId;

  // Suggest username from email or name
  const suggestedUsername = deriveUsername(pending.email || pending.name || '');

  return renderPage('Complete Registration', fedcmTemplate, {
    token,
    idpName,
    email: pending.email || '',
    suggestedUsername,
    error: reqCtx.url.searchParams.get('error') || '',
  }, { lang });
}

/**
 * POST /signup/fedcm — process FedCM registration.
 */
export async function handleFedCMSignup(reqCtx) {
  const { request, env, config, lang } = reqCtx;
  const t = getTranslations(lang);

  const form = await request.formData();
  const token = form.get('token') || '';
  const username = (form.get('username') || '').trim().toLowerCase();

  // Look up pending registration
  const pendingData = await env.APPDATA.get(`fedcm_pending:${token}`);
  if (!pendingData) {
    return new Response(t.err_token_expired, { status: 400 });
  }
  const pending = JSON.parse(pendingData);

  // Validate username
  if (!username || !/^[a-zA-Z0-9_-]+$/.test(username)) {
    return renderPage('Complete Registration', fedcmTemplate, {
      token,
      idpName: pending.idpId,
      email: pending.email || '',
      suggestedUsername: username,
      error: t.err_username_invalid,
    }, { lang });
  }
  if (RESERVED_NAMES.has(username)) {
    return renderPage('Complete Registration', fedcmTemplate, {
      token,
      idpName: pending.idpId,
      email: pending.email || '',
      suggestedUsername: username,
      error: t.err_username_reserved,
    }, { lang });
  }
  if (await userExists(env.APPDATA, username)) {
    return renderPage('Complete Registration', fedcmTemplate, {
      token,
      idpName: pending.idpId,
      email: pending.email || '',
      suggestedUsername: username,
      error: t.err_username_taken,
    }, { lang });
  }

  // Create user with sentinel password hash (cannot match any real password)
  await createUser(env.APPDATA, username, 'fedcm_only');

  // Bootstrap user pod
  await bootstrapUser(env, config, username, reqCtx.storage);

  // Link identity: store lookup key
  await env.APPDATA.put(`fedcm_link:${pending.idpId}:${pending.sub}`, username);

  // Update user meta with FedCM identity info
  const meta = await getUser(env.APPDATA, username);
  if (meta) {
    meta.fedcmIdentities = [{
      idpId: pending.idpId,
      sub: pending.sub,
      name: pending.name || '',
      email: pending.email || '',
      linkedAt: new Date().toISOString(),
    }];
    await env.APPDATA.put(`user_meta:${username}`, JSON.stringify(meta));
  }

  // Delete the pending token
  await env.APPDATA.delete(`fedcm_pending:${token}`);

  // Create session and redirect to dashboard
  const sessionToken = await createSession(env.APPDATA, username);
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/dashboard',
      'Set-Cookie': `session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${config.protocol === 'https' ? '; Secure' : ''}`,
      'Set-Login': 'logged-in',
    },
  });
}

/**
 * Derive a suggested username from an email or name.
 */
function deriveUsername(input) {
  // Try email local part first
  const atIdx = input.indexOf('@');
  const base = atIdx > 0 ? input.slice(0, atIdx) : input;
  return base.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30) || '';
}
