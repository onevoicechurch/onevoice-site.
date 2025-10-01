import { kv } from "../_lib/kv";

export const runtime = "nodejs";

const enc = new TextEncoder();

function sseHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // try to avoid buffering on some proxies
  };
}

function write(controller, payload) {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  controller.enqueue(enc.encode(line));
}

export async function GET(req) {
  const u = new URL(req.url);
  const code = (u.searchParams.get("code") || "").toUpperCase();
  if (!code) return new Response("Missing code", { status: 400 });

  const key = `onevoice:log:${code}`;

  let timer;

  const stream = new ReadableStream({
    async start(controller) {
      // initial event so the client knows we’re live
      write(controller, { ok: true, ready: true });

      timer = setInterval(async () => {
        try {
          const len = await kv.llen(key);
          if (len > 0) {
            const items = await kv.lrange(key, 0, -1); // read all
            for (const item of items) write(controller, item);
            await kv.del(key); // clear after flushing
          }
        } catch (e) {
          write(controller, { ok: false, error: "kv_error", message: String(e) });
          clearInterval(timer);
          controller.close();
        }
      }, 800); // ~1s polling
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
