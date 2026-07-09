/**
 * Solid Notifications Protocol handlers.
 *
 * Endpoints:
 *   GET  /:user/.notifications          — storage description (JSON-LD)
 *   POST /:user/.notifications/subscribe — create a notification channel
 *   GET  /:user/.notifications/channel/:id — StreamingHTTP (SSE) channel
 */
import { subscribeResource } from '../events.js';
import { simpleHash } from '../utils.js';
import { extractOwner, checkAccess } from './ldp.js';
import { getUserConfig } from '../config.js';

// In-memory channel registry: channelId → { resourceIri, unsubscribe }
const channels = new Map();

/**
 * GET /:user/.notifications — Solid storage description with notification service.
 */
export function handleStorageDescription(reqCtx) {
  const { config, params } = reqCtx;
  const username = params.user;
  const baseUrl = config.baseUrl;

  const description = {
    '@context': [
      'https://www.w3.org/ns/solid/notifications/v1',
      'https://www.w3.org/ns/activitystreams',
    ],
    id: `${baseUrl}/${username}/.notifications`,
    'notify:subscription': `${baseUrl}/${username}/.notifications/subscribe`,
    'notify:channelType': 'http://www.w3.org/ns/solid/notifications#StreamingHTTPChannel2023',
    'notify:features': ['accept', 'state'],
  };

  return new Response(JSON.stringify(description, null, 2), {
    headers: {
      'Content-Type': 'application/ld+json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * POST /:user/.notifications/subscribe — create a subscription channel.
 * Request body: { "topic": "https://example.org/resource" }
 */
export async function handleSubscribe(reqCtx) {
  const { request, config, params, storage, env } = reqCtx;
  const username = params.user;
  const baseUrl = config.baseUrl;

  let body;
  try { body = await request.json(); } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const topic = body.topic || body.object;
  if (!topic) {
    return new Response('Missing topic', { status: 400 });
  }

  // Validate topic is a resource on this server
  if (!topic.startsWith(baseUrl + '/')) {
    return new Response('Topic must be a resource on this server', { status: 400 });
  }

  // A subscriber must have Read access to the topic resource — otherwise
  // anyone could subscribe to change notifications for private resources
  // they aren't allowed to read.
  const topicOwner = extractOwner(topic, baseUrl);
  const ownerWebId = getUserConfig(config, topicOwner).webId;
  const agentWebId = reqCtx.userConfig ? reqCtx.userConfig.webId : null;
  const access = await checkAccess(storage, env.APPDATA, topic, agentWebId, ownerWebId, topicOwner);
  if (!access.readable) {
    return new Response('Forbidden — no read access to topic resource', { status: 403 });
  }

  const channelId = simpleHash(topic + ':' + crypto.randomUUID());
  const receiveFrom = `${baseUrl}/${username}/.notifications/channel/${channelId}`;

  // Store channel metadata (actual subscription happens when client connects)
  channels.set(channelId, { resourceIri: topic, owner: username });

  const channel = {
    '@context': [
      'https://www.w3.org/ns/solid/notifications/v1',
      'https://www.w3.org/ns/activitystreams',
    ],
    id: receiveFrom,
    type: 'http://www.w3.org/ns/solid/notifications#StreamingHTTPChannel2023',
    topic,
    receiveFrom,
  };

  return new Response(JSON.stringify(channel, null, 2), {
    status: 201,
    headers: {
      'Content-Type': 'application/ld+json',
      'Location': receiveFrom,
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * GET /:user/.notifications/channel/:id — StreamingHTTP (SSE) notification channel.
 */
export function handleNotificationChannel(reqCtx) {
  const { params } = reqCtx;
  const channelId = params.id;

  const channelMeta = channels.get(channelId);
  if (!channelMeta) {
    return new Response('Channel not found', { status: 404 });
  }

  const { resourceIri } = channelMeta;
  const encoder = new TextEncoder();

  let unsubscribe = null;
  let keepaliveTimer = null;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(':ok\n\n'));

      unsubscribe = subscribeResource(resourceIri, (notification) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(notification)}\n\n`));
        } catch (_) {}
      });

      keepaliveTimer = setInterval(() => {
        try { controller.enqueue(encoder.encode(':keepalive\n\n')); } catch (_) {}
      }, 15000);
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      channels.delete(channelId);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
