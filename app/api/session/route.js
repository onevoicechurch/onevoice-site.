import { NextResponse } from 'next/server';
import { createSession, endSession, newCode } from '../_lib/sessionStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const provided = (body && body.code) ? String(body.code) : null;
    const code = (provided || newCode()).toUpperCase();
    createSession(code);
    return NextResponse.json({ ok: true, code });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req) {
  const url = new URL(req.url);
  const code = (url.searchParams.get('code') || '').toUpperCase();
  if (!code) return NextResponse.json({ ok: false, error: 'code required' }, { status: 400 });
  endSession(code);
  return NextResponse.json({ ok: true });
}
