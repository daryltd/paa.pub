/**
 * SSRF protection — validate URLs before outbound fetch().
 *
 * Rejects:
 *   - Non-HTTP(S) schemes
 *   - Private/reserved IPs: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12,
 *     192.168.0.0/16, 169.254.0.0/16, ::1, fc00::/7
 *   - localhost hostname
 */

/**
 * Validate that a URL is safe for outbound requests.
 * @param {string} url - The URL to validate
 * @returns {boolean} true if safe, false if it should be blocked
 */
export function validateExternalUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Only allow HTTP(S) schemes
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  // Block localhost
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === 'localhost.localdomain') {
    return false;
  }

  // Block private/reserved IPv4 addresses
  if (isPrivateIPv4(hostname)) {
    return false;
  }

  // Block private/reserved IPv6 addresses
  if (isPrivateIPv6(hostname)) {
    return false;
  }

  return true;
}

/**
 * Check if a hostname is a private/reserved IPv4 address.
 */
function isPrivateIPv4(hostname) {
  // Match dotted-decimal IPv4
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;

  const [, a, b, c, d] = match.map(Number);
  if (a > 255 || b > 255 || c > 255 || d > 255) return false;

  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8
  if (a === 0) return true;

  return false;
}

/**
 * Check if a hostname is a private/reserved IPv6 address.
 */
function isPrivateIPv6(hostname) {
  // IPv6 addresses in URLs are enclosed in brackets
  let addr = hostname;
  if (addr.startsWith('[') && addr.endsWith(']')) {
    addr = addr.slice(1, -1);
  }

  // Normalize
  const lower = addr.toLowerCase();

  // ::1 (loopback)
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;

  // fc00::/7 (unique local)
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;

  // fe80::/10 (link-local)
  if (lower.startsWith('fe80')) return true;

  // :: (unspecified)
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;

  return false;
}
