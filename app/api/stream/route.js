import { NextResponse } from 'next/server';
import { getSince } from '@/app/api/_lib/sessionStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  const code = (url.searchParams.get('code') || '').toString().trim().slice(0, 8);
  const since = Number(url.searchParams.get('since') || '0');
  if (!code) return NextResponse.json({ items: [], next: since });
  const { items, next } = getSince(code, since);
  return NextResponse.json({ items, next });
}
