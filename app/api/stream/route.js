export const runtime = 'nodejs';

import { kv } from '../_lib/kv.js';

const enc = new TextEncoder();
const listKey = (code) => `onevoice:log:${code}`;

function sseHeaders() {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
  };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = (searchParams.get('code') || '').toUpperCase();
  if (!code) return new Response('Missing code', { status: 400 });

  const stream = new ReadableStream({
    async start(controller) {
      let idx = 0;
      controller.enqueue(enc.encode(`event: ready\ndata: "${code}"\n\n`));

      async function tick() {
        try {
          const len = await kv.llen(listKey(code));
          if (len > idx) {
            const items = await kv.lrange(listKey(code), idx, len - 1);
            idx = len;
            for (const item of items) {
              controller.enqueue(enc.encode(`data: ${JSON.stringify(item)}\n\n`));
            }
          }
          controller.enqueue(enc.encode(`event: ping\ndata: "${Date.now()}"\n\n`));
        } catch (e) {
          controller.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify(String(e))}\n\n`));
        }
      }

      const interval = setInterval(tick, 1000);
      tick();
      this._close = () => clearInterval(interval);
    },
    cancel() {
      if (this._close) this._close();
    }
  });

  return new Response(stream, { headers: sseHeaders() });
}
