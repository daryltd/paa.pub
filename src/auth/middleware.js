/**
 * Auth middleware: extract user from session cookie.
 */
import { getSession, parseCookie } from './session.js';

/**
 * Extract authenticated user from request cookie.
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<string|null>} username or null
 */
export async function extractUser(request, env) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = parseCookie(cookieHeader);
  if (!cookies.session) return null;

  const session = await getSession(env.APPDATA, cookies.session);
  return session ? session.username : null;
}

/**
 * Require authentication. Returns 401 redirect if not logged in.
 * @param {object} reqCtx
 * @returns {Response|null} null if authenticated, redirect Response if not
 */
export function requireAuth(reqCtx) {
  if (!reqCtx.user) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': '/login' },
    });
  }
  return null;
}
