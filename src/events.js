/**
 * In-memory pub/sub event bus for real-time activity notifications.
 * Keyed by username — each user has a set of listener callbacks.
 */
const listeners = new Map();

export function publish(username, event) {
  const set = listeners.get(username);
  if (!set) return;
  for (const cb of set) {
    try { cb(event); } catch (_) {}
  }
}

export function subscribe(username, callback) {
  if (!listeners.has(username)) listeners.set(username, new Set());
  listeners.get(username).add(callback);
  return () => {
    const set = listeners.get(username);
    if (set) {
      set.delete(callback);
      if (set.size === 0) listeners.delete(username);
    }
  };
}
