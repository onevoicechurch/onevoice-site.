// /app/api/stream/route.js
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { getSession, attachListener, detachListener } from '../_lib/sessionStore';

export async function GET(req) {
  const code = new URL(req.url).searchParams.get('code') || '';
  const session = getSession(code);

  if (!code || !session) {
    return new Response(JSON.stringify({ ok: false, error: 'No such session' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let resRef = null; // will hold the "res-like" writer we attach

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Make a tiny "res-like" object that writes SSE frames into the stream
      const res = {
        write: (chunk) => controller.enqueue(encoder.encode(chunk)),
        flush: () => {}, // no-op (Node/Vercel buffering is fine)
        end: () => controller.close(),
      };
      resRef = res;

      // Attach this client to the session; history is sent inside attachListener
      attachListener(code, res);

      // Send an initial comment so the connection opens cleanly
      res.write(`: connected\n\n`);

      // Keep-alive ping (many proxies drop idle SSE)
      const pingId = setInterval(() => {
        try { res.write(`: ping ${Date.now()}\n\n`); } catch {}
      }, 15000);

      // If the request aborts (tab closed, nav away), clean up
      try {
        req.signal.addEventListener('abort', () => {
          clearInterval(pingId);
          try { detachListener(code, res); } catch {}
          try { res.end(); } catch {}
        });
      } catch {
        // some runtimes don’t expose req.signal—cancel() below will still run
      }
    },

    cancel() {
      // Fallback cleanup if the stream is canceled by the runtime
      if (resRef) {
        try { detachListener(code, resRef); } catch {}
        try { resRef.end(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
