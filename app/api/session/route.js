import { NextResponse } from 'next/server';
import { kv } from '../_lib/kv';

export const runtime = 'nodejs';

function newCode() {
  // short random session code
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

// Create a session (returns { ok, code })
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const provided = body?.code ? String(body.code) : '';
  const code = (provided || newCode()).toUpperCase().slice(0, 8);

  // initialize an empty log list for this session (optional)
  await kv.set(`onevoice:session:${code}`, { createdAt: Date.now() });

  return NextResponse.json({ ok: true, code });
}

// Delete a session
export async function DELETE(req) {
  const url = new URL(req.url);
  const code = (url.searchParams.get('code') || '').toUpperCase();
  if (!code) {
    return NextResponse.json({ ok: false, error: 'MISSING_CODE' }, { status: 400 });
  }
  await kv.del(`onevoice:session:${code}`);
  await kv.del(`onevoice:log:${code}`);
  return NextResponse.json({ ok: true });
}
