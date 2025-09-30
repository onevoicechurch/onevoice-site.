import { NextResponse } from 'next/server';
import { createSession, endSession } from '@/app/api/_lib/sessionStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const code = (body?.code || '').toString().trim().slice(0, 8);
  if (!code) return NextResponse.json({ ok: false, error: 'missing code' }, { status: 400 });
  createSession(code);
  return NextResponse.json({ ok: true, code });
}

export async function DELETE(req) {
  const url = new URL(req.url);
  const code = (url.searchParams.get('code') || '').toString().trim().slice(0, 8);
  if (!code) return NextResponse.json({ ok: false, error: 'missing code' }, { status: 400 });
  endSession(code);
  return NextResponse.json({ ok: true });
}
