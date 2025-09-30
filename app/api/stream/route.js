import { getLinesSince } from '../_lib/sessionStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sseTransform() {
  const encoder = new TextEncoder();
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(encoder.encode(chunk));
    }
  });
}

export async function GET(req) {
  const u = new URL(req.url);
  const code = (u.searchParams.get('code') || '').toUpperCase();
  const since = Number(u.searchParams.get('since') || 0);

  if (!code) {
    return new Response('missing code', { status: 400 });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const send = async (obj) => writer.write(`data: ${JSON.stringify(obj)}\n\n`);

  // Kick initial batch
  let lastId = Number.isNaN(since) ? 0 : since;
  const initial = await getLinesSince(code, lastId, 100);
  if (initial.length) {
    lastId = initial[initial.length - 1].id;
    await send({ type: 'batch', lines: initial });
  } else {
    await send({ type: 'noop' });
  }

  // Poll loop (lightweight) for up to 60s; client will reconnect
  let alive = true;
  req.signal.addEventListener('abort', () =>
