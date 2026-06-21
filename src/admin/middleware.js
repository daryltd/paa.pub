/**
 * Admin middleware: require admin user.
 */

export function requireAdmin(reqCtx) {
  if (!reqCtx.user) {
    return new Response(null, { status: 302, headers: { 'Location': '/login?return_to=/admin' } });
  }
  if (reqCtx.user !== reqCtx.config.adminUsername) {
    return new Response('Forbidden', { status: 403 });
  }
  return null;
}
