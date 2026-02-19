/**
 * Minimal URL pattern router for Cloudflare Workers.
 */
export class Router {
  constructor() {
    /** @type {Array<{method: string, pattern: RegExp, keys: string[], handler: Function}>} */
    this.routes = [];
  }

  /**
   * Register a route.
   * @param {string} method - HTTP method or '*'
   * @param {string} pattern - URL pattern with :param and * wildcards
   * @param {Function} handler - async (ctx) => Response
   */
  add(method, pattern, handler) {
    const keys = [];
    const regexStr = pattern
      .replace(/:([a-zA-Z_]+)/g, (_, key) => {
        keys.push(key);
        return '([^/]+)';
      })
      .replace(/\*\*/g, () => {
        keys.push('wild');
        return '(.*)';
      })
      .replace(/\*/g, () => {
        keys.push('wild');
        return '(.*)';
      });
    this.routes.push({
      method: method.toUpperCase(),
      pattern: new RegExp(`^${regexStr}$`),
      keys,
      handler,
    });
  }

  get(pattern, handler) { this.add('GET', pattern, handler); }
  post(pattern, handler) { this.add('POST', pattern, handler); }

  /**
   * Match a request to a route.
   * @param {string} method
   * @param {string} pathname
   * @returns {{ handler: Function, params: object } | null}
   */
  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== '*' && route.method !== method) continue;
      const m = pathname.match(route.pattern);
      if (m) {
        const params = {};
        route.keys.forEach((key, i) => { params[key] = m[i + 1]; });
        return { handler: route.handler, params };
      }
    }
    return null;
  }
}
