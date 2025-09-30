import { NextResponse } from 'next/server';
import { getSession, attachListener, detachListener } from '../_lib/sessionStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  const url = new URL(req.url);
  const code = (url.searchParams.get('code') || '').toUpperCase();

  // SSE headers
  const headers = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
  };

  // Fake "res" object with write/flush/end for our session store
  const res = {
    write: (chunk) => writer.write(enc.encode(chunk)),
    end: () => writer.close(),
    flush: () => {},
  };

  if (!code || !getSession(code)) {
    await writer.write(enc.encode(`event: end\ndata: {}\n\n`));
    await writer.close();
    return new NextResponse(readable, { headers });
  }

  attachListener(code, res);

  // Heartbeat
  const iv = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 15000);

  // Close on client abort
  req.signal.addEventListener('abort', () => {
    clearInterval(iv);
    detachListener(code, res);
    try { writer.close(); } catch {}
  });

  return new NextResponse(readable, { headers });
}
