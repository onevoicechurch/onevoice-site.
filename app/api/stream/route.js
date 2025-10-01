// app/api/stream/route.ts
import { kv } from "../_lib/kv";

export const runtime = "nodejs";

const listKey = (code: string) => `onevoice:log:${code}`;
const enc = new TextEncoder();

function sseInit(): Headers {
  const h = new Headers();
  h.set("Content-Type", "text/event-stream; charset=utf-8");
  h.set("Cache-Control", "no-cache, no-transform");
  h.set("Connection", "keep-alive");
  h.set("X-Accel-Buffering", "no"); // avoid buffering on some proxies
  return h;
}

// Utility to write one SSE event
async function writeEvent(writer: WritableStreamDefaultWriter<Uint8Array>, payload: unknown) {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  await writer.write(enc.encode(line));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = (searchParams.get("code") || "").toUpperCase();
  if (!code) {
    return new Response(JSON.stringify({ ok: false, error: "MISSING_CODE" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers = sseInit();

  // Stream response body
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writer = controller.writable?.getWriter?.() ?? (controller as any).getWriter?.() ?? (controller as any);
      const w = (writer as WritableStreamDefaultWriter<Uint8Array>) || {
        write: (chunk: Uint8Array) => controller.enqueue(chunk),
      };

      // Initial hello
      await writeEvent(w, { ok: true, ready: true, code });

      let cursor = 0;
      const key = listKey(code);
      const abort = (req as any).signal as AbortSignal | undefined;

      // Poll loop — lightweight, stateless, Vercel-friendly
      try {
        while (!abort?.aborted) {
          // How many items currently in the list?
          const len = (await kv.llen(key)) ?? 0;

          if (len > cursor) {
            // Fetch only the new slice [cursor .. end]
            const items = (await kv.lrange<string>(key, cursor, -1)) || [];
            for (const raw of items) {
              try {
                const parsed = JSON.parse(raw);
                await writeEvent(w, parsed);
              } catch {
                // If a malformed entry appears, still forward raw text
                await writeEvent(w, { text: raw });
              }
            }
            cursor = len;
          }

          // Idle wait
          await new Promise((r) => setTimeout(r, 800));
        }
      } catch (e) {
        // If something unexpected happens, try to tell the client
        try { await writeEvent(w, { ok: false, error: "STREAM_ERROR" }); } catch {}
      } finally {
        try { await writeEvent(w, { ok: false, end: true }); } catch {}
        controller.close();
      }
    },
  });

  return new Response(stream, { headers });
}
