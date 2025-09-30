import { NextResponse } from 'next/server';
import { createSession, endSession, newCode } from '../_lib/sessionStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const provided = body?.code ? String(body.code) : null;
    const code = provided || newCode();
    createSession(code);
    return NextResponse.json({ ok: true, code });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'create_failed' }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    if (!code) return NextResponse.json({ ok: false, error: 'missing_code' }, { status: 400 });
    endSession(code.toUpperCase());
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'end_failed' }, { status: 500 });
  }
}
