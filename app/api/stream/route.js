import { kv } from '../_lib/kv';

export const runtime = 'nodejs';

const enc = new TextEncoder();

function sseHeaders() {
  return new Headers({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no' // helps prevent proxy buffering
  });
}

function writeEvent(writer, payload) {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  return writer.write(enc.encode(line));
}

// Server-Sent Events stream: clients receive appended log lines
export async function GET(req) {
  const url = new URL(req.url);
  const code = (url.searchParams.get('code') || '').toUpperCase();
  if (!code) {
    return new Response(JSON.stringify({ ok: false, error: 'MISSING_CODE' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const logKey = `onevoice:log:${code}`;
  let cursor = 0; // how many entries we’ve sent

  const stream = new ReadableStream({
    async start(controller) {
      const writer = controller;

      // Initial replay (send anything already in the list)
      const existing = await kv.lrange(logKey, 0, -1);
      for (const item of existing) {
        await writeEvent(writer, { type: 'line', ...item });
      }
      cursor = existing.length;

      // Poll for new entries every 300ms
      const timer = setInterval(async () => {
        try {
          const total = await kv.llen(logKey);
          if (total > cursor) {
            const fresh = await kv.lrange(logKey, cursor, total - 1);
            for (const item of fresh) {
              await writeEvent(writer, { type: 'line', ...item });
            }
            cursor = total;
          }
          // keep-alive ping
          await writeEvent(writer, { type: 'ping', t: Date.now() });
        } catch (e) {
          await writeEvent(writer, { type: 'error', message: String(e) });
        }
      }, 300);

      // Cleanup
      stream.cancel = () => clearInterval(timer);
    },
    cancel() {
      // handled above
    }
  });

  return new Response(stream, { headers: sseHeaders() });
}
