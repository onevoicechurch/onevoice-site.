export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { addLine, getSession } from '../_lib/sessionStore';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MIN_BYTES = 3500;

async function transcribe(ab, contentType, inputLang) {
  const blob = new Blob([ab], { type: contentType || 'audio/webm' });

  // Try gpt-4o-mini-transcribe first
  try {
    const fd = new FormData();
    fd.append('file', blob, `clip.${(contentType || '').split('/')[1] || 'webm'}`);
    fd.append('model', 'gpt-4o-mini-transcribe');
    if (inputLang && inputLang !== 'AUTO') {
      fd.append('language', inputLang.split('-')[0]);
    }
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: fd,
    });
    if (r.ok) {
      const j = await r.json();
      if (j?.text) return j.text.trim();
    } else if (r.status !== 400) {
      const t = await r.text();
      throw new Error(`4o-mini failed ${r.status}: ${t}`);
    }
    // else fall through to whisper on 400
  } catch {}

  // Whisper fallback
  const fd2 = new FormData();
  fd2.append('file', blob, `clip.${(contentType || '').split('/')[1] || 'webm'}`);
  fd2.append('model', 'whisper-1');
  if (inputLang && inputLang !== 'AUTO') {
    fd2.append('language', inputLang.split('-')[0]);
  }
  const r2 = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: fd2,
  });
  if (!r2.ok) {
    const t = await r2.text();
    throw new Error(`whisper-1 failed ${r2.status}: ${t}`);
  }
  const j2 = await r2.json();
  return (j2.text || '').trim();
}

export async function POST(req) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code') || '';
    const inputLang = url.searchParams.get('inputLang') || 'AUTO';

    if (!code || !getSession(code)) {
      return NextResponse.json({ ok: false, error: 'No such session' }, { status: 404 });
    }

    const contentType = req.headers.get('content-type') || 'audio/webm';
    const ab = await req.arrayBuffer();
    if (!ab || ab.byteLength < MIN_BYTES) {
      return NextResponse.json({ ok: false, error: 'Blob too small' }, { status: 400 });
    }

    const text = await transcribe(ab, contentType, inputLang);
    if (text) {
      addLine(code, { ts: Date.now(), en: text });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: msg });
  }
}
