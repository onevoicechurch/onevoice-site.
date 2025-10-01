import { NextResponse } from 'next/server';
import { kv, appendLog } from '../_lib/kv';

export const runtime = 'nodejs';

// Accept text chunks from the operator console and store to KV
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const code = (body?.code || '').toUpperCase();
  const text = body?.text || '';
  const lang = body?.lang || ''; // optional, iso code like 'en', 'es'

  if (!code || !text) {
    return NextResponse.json({ ok: false, error: 'MISSING_CODE_OR_TEXT' }, { status: 400 });
  }

  // Append to the session log (used by /api/stream to fan out to listeners)
  await appendLog(code, text);

  // Optionally flag “latest line” for quick polling UIs
  await kv.set(`onevoice:latest:${code}`, { text, lang, t: Date.now() });

  return NextResponse.json({ ok: true });
}
