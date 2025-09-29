import { NextResponse } from 'next/server';
import { getSession, attachListener, detachListener } from '../_lib/sessionStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const code = new URL(req.url).searchParams.get('code') || '';
  const session = getSession(code);
  if (!code || !session) {
    return NextResponse.json({ ok: false, error: 'No such session' }, { status: 404 });
  }

  let resObj = null;

  const stream = new ReadableStream({
    start(controller) {
      resObj = {
        write: (chunk) => controller.enqueue(new TextEncoder().encode(chunk)),
        flush: () => {},
        end: () => controller.close(),
      };
      attachListener(code, resObj);
    },
    cancel() {
      if (resObj) detachListener(code, resObj);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
