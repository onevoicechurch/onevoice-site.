export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { newCode, createSession, endSession, getSession } from '../_lib/sessionStore';

export async function POST() {
  const code = newCode();
  createSession(code);
  return NextResponse.json({ ok: true, code });
}

export async function DELETE(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code') || '';
  if (!code || !getSession(code)) return NextResponse.json({ ok: false }, { status: 404 });
  endSession(code);
  return NextResponse.json({ ok: true });
}
