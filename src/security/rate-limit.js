/**
 * KV-backed sliding window rate limiter using APPDATA.
 *
 * Key: `ratelimit:{category}:{ip}`
 * Value: `{ count, windowStart }` (auto-expires via KV TTL)
 *
 * Categories:
 *   login    — 10 req / 15 min  (POST /login, POST /authorize password)
 *   webauthn — 20 req / 15 min  (POST /webauthn/login/*)
 *   token    — 30 req / 1 min   (POST /token)
 *   register — 10 req / 1 hour  (POST /register)
 *   inbox    — 60 req / 1 min   (POST /:user/inbox)
 *   write    — 60 req / 1 min   (LDP PUT/POST/PATCH/DELETE)
 */

const RATE_LIMITS = {
  login:    { window: 15 * 60, max: 10 },
  webauthn: { window: 15 * 60, max: 20 },
  token:    { window: 60,      max: 30 },
  register: { window: 60 * 60, max: 10 },
  inbox:    { window: 60,      max: 60 },
  write:    { window: 60,      max: 60 },
};

/**
 * Check whether a request is within rate limits.
 * @param {KVNamespace} kv - APPDATA
 * @param {string} category - Rate limit category
 * @param {string} ip - Client IP address
 * @returns {Promise<{allowed: boolean, remaining: number, retryAfter: number}>}
 */
export async function checkRateLimit(kv, category, ip) {
  const config = RATE_LIMITS[category];
  if (!config) return { allowed: true, remaining: 999, retryAfter: 0 };

  const key = `ratelimit:${category}:${ip}`;
  const now = Math.floor(Date.now() / 1000);

  const data = await kv.get(key);
  let record = data ? JSON.parse(data) : null;

  if (!record || (now - record.windowStart) >= config.window) {
    // New window
    record = { count: 1, windowStart: now };
    await kv.put(key, JSON.stringify(record), { expirationTtl: config.window });
    return { allowed: true, remaining: config.max - 1, retryAfter: 0 };
  }

  if (record.count >= config.max) {
    const retryAfter = config.window - (now - record.windowStart);
    return { allowed: false, remaining: 0, retryAfter };
  }

  record.count++;
  const ttl = config.window - (now - record.windowStart);
  await kv.put(key, JSON.stringify(record), { expirationTtl: Math.max(ttl, 1) });
  return { allowed: true, remaining: config.max - record.count, retryAfter: 0 };
}

/**
 * Build a 429 Too Many Requests response.
 * @param {number} retryAfter - Seconds until the client can retry
 * @returns {Response}
 */
export function rateLimitResponse(retryAfter) {
  return new Response('Too Many Requests', {
    status: 429,
    headers: {
      'Retry-After': String(retryAfter),
      'Content-Type': 'text/plain',
    },
  });
}
