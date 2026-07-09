/**
 * User registration: GET/POST /signup.
 */
import { renderPage } from '../ui/shell.js';
import { hashPassword } from './password.js';
import { createSession } from './session.js';
import { createUser, userExists } from '../users.js';
import { bootstrapUser } from '../bootstrap.js';
import { RESERVED_NAMES } from '../config.js';
import { getTranslations } from '../i18n/index.js';
import { loadHtml } from '../html-loader.js';
const template = await loadHtml(import.meta.url, '../ui/templates/signup.html', () => import('../ui/templates/signup.html'));

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
  const returnTo = reqCtx.url.searchParams.get('return_to') || '';
  return renderPage('Sign Up', template, { error, username: '', returnTo }, { lang });
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

  // Auto-login: create session and redirect
  const token = await createSession(env.APPDATA, username);
  const returnTo = form.get('return_to') || reqCtx.url?.searchParams.get('return_to') || '';
  const location = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/dashboard';
  return new Response(null, {
    status: 302,
    headers: {
      'Location': location,
      'Set-Cookie': `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${config.protocol === 'https' ? '; Secure' : ''}`,
      'Set-Login': 'logged-in',
    },
  });
}

