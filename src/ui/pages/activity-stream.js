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

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(':ok\n\n'));

      const unsubscribe = subscribe(username, (event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch (_) {}
      });

      const keepalive = setInterval(() => {
        try { controller.enqueue(encoder.encode(':keepalive\n\n')); } catch (_) {}
      }, 30000);

      // Store cleanup refs on the controller for cancel
      controller._cleanup = () => {
        unsubscribe();
        clearInterval(keepalive);
      };
    },
    cancel(controller) {
      if (controller?._cleanup) controller._cleanup();
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
