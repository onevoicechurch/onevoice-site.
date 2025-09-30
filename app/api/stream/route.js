import { NextResponse } from 'next/server';
import { attachListener, detachListener, getSession } from '@/app/api/_lib/sessionStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code')?.toUpperCase();
  if (!code || !getSession(code)) {
    return new NextResponse('missing or invalid code', { status: 400 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const resShim = {
        write(chunk) { controller.enqueue(encoder.encode(chunk)); },
        end() { try { controller.close(); } catch {} },
        flush() {}
      };
      attachListener(code, resShim);
      // keepalive ping
      const ping = setInterval(() => {
        try { resShim.write(`event: ping\ndata: {}\n\n`); } catch {}
      }, 15000);

      // on cancel
      controller.oncancel = () => {
        clearInterval(ping);
        detachListener(code, resShim);
      };
    }
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}
