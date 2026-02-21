/**
 * CORS handling for Solid protocol.
 */

const ALLOWED_METHODS = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Authorization, Content-Type, Accept, Origin, Slug, Link, If-Match, If-None-Match, Prefer, DPoP';
const EXPOSED_HEADERS = 'Accept-Patch, Accept-Post, Accept-Put, Allow, Content-Range, ETag, Last-Modified, Link, Location, Updates-Via, WAC-Allow, WWW-Authenticate';

/**
 * Apply CORS headers to a response.
 * @param {Response} response
 * @param {Request} request
 * @returns {Response}
 */
export function applyCors(response, request) {
  const origin = request.headers.get('Origin') || '*';
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS);
  headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  headers.set('Access-Control-Expose-Headers', EXPOSED_HEADERS);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
