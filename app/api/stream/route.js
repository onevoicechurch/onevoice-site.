// /app/api/stream/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getSession, attachListener, detachListener } from "@/app/api/_lib/sessionStore";

// Server-Sent Events stream for live captions
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code") || "";

  const session = getSession(code);
  if (!code || !session) {
    return new Response(JSON.stringify({ ok: false, error: "No such session" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Create an SSE Response using a ReadableStream
  const stream = new ReadableStream({
    start(controller) {
      // Minimal "res-like" object that sessionStore expects
      const res = {
        write: (chunk) => controller.enqueue(new TextEncoder().encode(chunk)),
        flush: () => {}, // no-op on web streams
        end: () => controller.close(),
      };

      // Attach the listener (this also replays history)
      const ok = attachListener(code, res);
      if (!ok) {
        controller.error(new Error("attachListener failed"));
        return;
      }

      // Keep-alive pings so proxies don’t close the connection
      const ka = setInterval(() => {
        try {
          res.write(`: keep-alive ${Date.now()}\n\n`);
        } catch {}
      }, 20000);

      // If the client disconnects, clean up
      const abort = req.signal;
      const onAbort = () => {
        clearInterval(ka);
        detachListener(code, res);
        try { res.end(); } catch {}
      };
      abort.addEventListener("abort", onAbort);
    },
    cancel() {
      // The abort handler above will run and detach the listener.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Required for Vercel/Next to flush progressively
      "Transfer-Encoding": "chunked",
      // Avoid buffering by CDNs / proxies
      "X-Accel-Buffering": "no",
    },
  });
}
