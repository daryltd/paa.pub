/**
 * SSE endpoint for real-time activity updates.
 * GET /activity/stream — returns text/event-stream.
 */
import { requireAuth } from '../../auth/middleware.js';
import { subscribe } from '../../events.js';

export async function handleActivityStream(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const username = reqCtx.user;
  const encoder = new TextEncoder();

  let unsubscribe = null;
  let keepaliveTimer = null;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(':ok\n\n'));

      unsubscribe = subscribe(username, (event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch (_) {}
      });

      // Keepalive every 15s to prevent proxy timeouts
      keepaliveTimer = setInterval(() => {
        try { controller.enqueue(encoder.encode(':keepalive\n\n')); } catch (_) {}
      }, 15000);
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (keepaliveTimer) clearInterval(keepaliveTimer);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
