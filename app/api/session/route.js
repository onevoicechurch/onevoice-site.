export const runtime = 'nodejs';

import { kv } from '../_lib/kv.js';

function newCode() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const provided = body?.code ? String(body.code) : '';
  const code = (provided || newCode()).toUpperCase();

  await kv.set(`onevoice:session:${code}`, { createdAt: Date.now() }, { ex: 60 * 60 * 4 });
  await kv.del(`onevoice:log:${code}`);
  return Response.json({ ok: true, code });
}

export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const code = (searchParams.get('code') || '').toUpperCase();
  if (code) {
    await kv.del(`onevoice:session:${code}`);
    await kv.del(`onevoice:log:${code}`);
  }
  return Response.json({ ok: true });
}
