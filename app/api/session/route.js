import { NextResponse } from 'next/server';
import { createSession, endSession, newCode } from '@/app/api/_lib/sessionStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const provided = (body && body.code) ? String(body.code).trim().toUpperCase() : null;
  const code = provided || newCode();
  createSession(code);
  return NextResponse.json({ ok: true, code });
}

export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code')?.toUpperCase();
  if (!code) return NextResponse.json({ ok: false, error: 'missing code' }, { status: 400 });
  endSession(code);
  return NextResponse.json({ ok: true });
}
