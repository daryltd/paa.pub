/**
 * Request size limit enforcement.
 *
 * Check Content-Length before reading body:
 *   JSON endpoints (OIDC, WebAuthn, inbox) — 1 MB
 *   RDF uploads (Turtle, N-Triples)        — 5 MB
 *   Binary uploads                         — 100 MB
 */

export const SIZE_LIMITS = {
  json:   1 * 1024 * 1024,        // 1 MB
  rdf:    5 * 1024 * 1024,        // 5 MB
  binary: 100 * 1024 * 1024,      // 100 MB
};

/**
 * Check Content-Length against a maximum byte limit.
 * @param {Request} request
 * @param {number} maxBytes
 * @returns {Response|null} 413 Response if too large, null if OK
 */
export function checkContentLength(request, maxBytes) {
  const cl = request.headers.get('Content-Length');
  if (cl && parseInt(cl, 10) > maxBytes) {
    return new Response('Payload Too Large', {
      status: 413,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
  return null;
}

/**
 * Determine the appropriate size limit for a request.
 * @param {Request} request
 * @returns {number} Maximum allowed bytes
 */
export function getSizeLimit(request) {
  const ct = (request.headers.get('Content-Type') || '').toLowerCase();
  if (ct.includes('application/json') || ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    // multipart/form-data with file uploads get binary limit
    if (ct.includes('multipart/form-data')) return SIZE_LIMITS.binary;
    return SIZE_LIMITS.json;
  }
  if (ct.includes('text/turtle') || ct.includes('application/n-triples') || ct.includes('application/n-quads') || ct.includes('application/sparql-update') || ct.includes('application/ld+json')) {
    return SIZE_LIMITS.rdf;
  }
  if (ct.includes('image/') || ct.includes('video/') || ct.includes('audio/') || ct.includes('application/octet-stream') || ct.includes('application/pdf') || ct.includes('application/zip') || ct.includes('application/gzip')) {
    return SIZE_LIMITS.binary;
  }
  return SIZE_LIMITS.json;
}
