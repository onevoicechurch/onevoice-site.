import { NextResponse } from 'next/server';
import { createSession, endSession } from '../_lib/sessionStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const provided = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : null;
  const code = provided || Math.random().toString(36).slice(2, 6).toUpperCase();
  await createSession(code);
  return NextResponse.json({ ok: true, code });
}

export async function DELETE(req) {
  const u = new URL(req.url);
  const code = (u.searchParams.get('code') || '').toUpperCase();
  if (!code) return NextResponse.json({ ok: false, error: 'missing code' }, { status: 400 });
  await endSession(code);
  return NextResponse.json({ ok: true });
}
