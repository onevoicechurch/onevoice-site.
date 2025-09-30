import { NextResponse } from 'next/server';
import { getSince } from '../_lib/sessionStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const code = (url.searchParams.get('code') || '').toUpperCase();
    const since = parseInt(url.searchParams.get('since') || '0', 10);
    const { items, next } = getSince(code, since);
    return NextResponse.json({ ok: true, items, next });
  } catch {
    return NextResponse.json({ ok: false, items: [], next: 0 }, { status: 500 });
  }
}
