export const runtime = 'nodejs';

import { kv, evKey } from '../_lib/kv';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  if (!code) return new Response('Missing code', { status:400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let cursor = 0;
      const key = evKey(code);
      const write = (obj) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      // Immediately send a 'ready' event so the UI knows SSE is alive
      write({ type:'ready', ts:Date.now() });

      const startedAt = Date.now();
      while (Date.now() - startedAt < 55000) { // ~55s, client will auto-reconnect
        try {
          const items = await kv.lrange(key, cursor, -1);
          if (items && items.length) {
            for (const s of items) {
              try {
                const ev = JSON.parse(s);
                write({ type:'transcript', ...ev });
              } catch {
                // ignore malformed
              }
            }
            cursor += items.length;
          }
        } catch {}
        await new Promise(r => setTimeout(r, 600));
      }
      // graceful end; client will reconnect
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    }
  });
}
