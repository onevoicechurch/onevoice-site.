export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSession, attachListener, detachListener } from '../_lib/sessionStore';

export async function GET(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code') || '';
  const s = getSession(code);
  if (!s) return new NextResponse('no session', { status: 404 });

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const resLike = {
        write: (chunk) => controller.enqueue(encoder.encode(chunk)),
        flush: () => {},
        end: () => controller.close(),
      };
      attachListener(code, resLike);

      // keep-alive ping
      const ping = setInterval(() => {
        controller.enqueue(encoder.encode(': ping\n\n'));
      }, 15000);

      // on cancel
      controller._cleanup = () => {
        clearInterval(ping);
        detachListener(code, resLike);
      };
    },
    cancel() {
      this._cleanup?.();
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
