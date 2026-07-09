/**
 * Solid Notifications Protocol — notification builder and emitter.
 *
 * Builds Activity Streams JSON-LD notifications and publishes
 * them to the resource-keyed event bus.
 */
import { publishResource } from '../events.js';
import { parentContainer } from './containers.js';

/**
 * Emit a Solid Notification for a resource change.
 * @param {string} resourceIri - the resource that changed
 * @param {string} type - AS2 type: 'Create', 'Update', 'Delete'
 * @param {object} [opts]
 * @param {string} [opts.parentIri] - parent container (for Add/Remove on parent)
 */
export function emitNotification(resourceIri, type, opts = {}) {
  const notification = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `urn:uuid:${crypto.randomUUID()}`,
    type,
    object: resourceIri,
    published: new Date().toISOString(),
  };

  // Notify subscribers of the resource itself
  publishResource(resourceIri, notification);

  // For Create/Delete, also notify parent container subscribers
  const parentIri = opts.parentIri || parentContainer(resourceIri);
  if (parentIri && (type === 'Create' || type === 'Delete')) {
    const parentNotification = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `urn:uuid:${crypto.randomUUID()}`,
      type: type === 'Create' ? 'Add' : 'Remove',
      object: resourceIri,
      target: parentIri,
      published: new Date().toISOString(),
    };
    publishResource(parentIri, parentNotification);
  }
}
