/**
 * In-memory pub/sub event bus.
 *
 * Two channels:
 *   - User-keyed: for ActivityPub real-time activity notifications
 *   - Resource-keyed: for Solid Notifications Protocol (resource change events)
 */

// ActivityPub: keyed by username
const userListeners = new Map();

export function publish(username, event) {
  const set = userListeners.get(username);
  if (!set) return;
  for (const cb of set) {
    try { cb(event); } catch (_) {}
  }
}

export function subscribe(username, callback) {
  if (!userListeners.has(username)) userListeners.set(username, new Set());
  userListeners.get(username).add(callback);
  return () => {
    const set = userListeners.get(username);
    if (set) {
      set.delete(callback);
      if (set.size === 0) userListeners.delete(username);
    }
  };
}

// Solid Notifications: keyed by resource IRI
const resourceListeners = new Map();

export function publishResource(resourceIri, notification) {
  const set = resourceListeners.get(resourceIri);
  if (!set) return;
  for (const cb of set) {
    try { cb(notification); } catch (_) {}
  }
}

export function subscribeResource(resourceIri, callback) {
  if (!resourceListeners.has(resourceIri)) resourceListeners.set(resourceIri, new Set());
  resourceListeners.get(resourceIri).add(callback);
  return () => {
    const set = resourceListeners.get(resourceIri);
    if (set) {
      set.delete(callback);
      if (set.size === 0) resourceListeners.delete(resourceIri);
    }
  };
}
