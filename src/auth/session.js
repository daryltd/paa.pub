/**
 * Session management via APPDATA KV with TTL.
 */
import { verifyPassword } from './password.js';
import { renderLoginPage } from '../ui/pages/login.js';

const SESSION_TTL = 86400; // 24 hours

/**
 * Create a session token and store in KV.
 * @param {KVNamespace} kv
 * @param {string} username
 * @returns {Promise<string>} session token
 */
export async function createSession(kv, username) {
  const token = generateToken();
  await kv.put(`session:${token}`, JSON.stringify({
    username,
    createdAt: new Date().toISOString(),
  }), { expirationTtl: SESSION_TTL });
  return token;
}

/**
 * Get session data from token.
 * @param {KVNamespace} kv
 * @param {string} token
 * @returns {Promise<object|null>}
 */
export async function getSession(kv, token) {
  const data = await kv.get(`session:${token}`);
  return data ? JSON.parse(data) : null;
}

/**
 * Destroy a session.
 * @param {KVNamespace} kv
 * @param {string} token
 */
export async function destroySession(kv, token) {
  await kv.delete(`session:${token}`);
}

/**
 * Handle POST /login
 */
export async function handleLogin(reqCtx) {
  const { request, env, config } = reqCtx;
  const form = await request.formData();
  const password = form.get('password') || '';
  const returnTo = form.get('return_to') || '';

  const userRecord = await env.APPDATA.get(`user:${config.username}`);
  if (!userRecord) {
    return renderLoginPage({ ...reqCtx, returnTo, error: 'User not configured' });
  }

  const valid = await verifyPassword(password, userRecord);
  if (!valid) {
    return renderLoginPage({ ...reqCtx, returnTo, error: 'Invalid password' });
  }

  // Redirect to return_to if it's a safe same-origin path, otherwise /dashboard
  const location = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/dashboard';
  const token = await createSession(env.APPDATA, config.username);
  return new Response(null, {
    status: 302,
    headers: {
      'Location': location,
      'Set-Cookie': `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}${config.protocol === 'https' ? '; Secure' : ''}`,
    },
  });
}

/**
 * Handle POST /logout
 */
export async function handleLogout(reqCtx) {
  const { request, env } = reqCtx;
  const cookie = parseCookie(request.headers.get('Cookie') || '');
  if (cookie.session) {
    await destroySession(env.APPDATA, cookie.session);
  }
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/login',
      'Set-Cookie': 'session=; Path=/; HttpOnly; Max-Age=0',
    },
  });
}

function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** @param {string} cookieHeader */
export function parseCookie(cookieHeader) {
  const cookies = {};
  for (const pair of cookieHeader.split(';')) {
    const [name, ...rest] = pair.trim().split('=');
    if (name) cookies[name.trim()] = rest.join('=').trim();
  }
  return cookies;
}
