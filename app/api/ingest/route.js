export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { addLine, getSession } from '@/app/api/_lib/sessionStore';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MIN_BYTES = 3500; // ignore tiny blobs

async function transcribe(ab, contentType, inputLang) {
  // prefer 4o-mini-transcribe, fall back to whisper-1 on 400 (format/corrupt)
  const blob = new Blob([ab], { type: contentType || 'audio/webm' });

  // --- try 4o-mini-transcribe ---
  try {
    const fd = new FormData();
    fd.append('file', blob, `clip.${(contentType || '').split('/')[1] || 'webm'}`);
    fd.append('model', 'gpt-4o-mini-transcribe');
    if (inputLang && inputLang !== 'AUTO') {
      // pass primary subtag (e.g. "en-US" -> "en")
      const primary = inputLang.split('-')[0];
      fd.append('language', primary);
    }
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: fd,
    });
    const ok = r.ok ? (await r.json()) : null;
    if (ok?.text) return ok.text.trim();
    if (!r.ok && r.status !== 400) {
      // non-format error: throw
      const msg = await r.text();
      throw new Error(`4o-mini failed ${r.status}: ${msg}`);
    }
    // else 400: fall through to whisper
  } catch (e) {
    // continue to whisper
  }

  // --- whisper-1 fallback ---
  const fd2 = new FormData();
  fd2.append('file', blob, `clip.${(contentType || '').split('/')[1] || 'webm'}`);
  fd2.append('model', 'whisper-1');
  if (inputLang && inputLang !== 'AUTO') {
    const primary = inputLang.split('-')[0];
    fd2.append('language', primary);
  }
  const r2 = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: fd2,
  });
  if (!r2.ok) {
    const msg = await r2.text();
    throw new Error(`whisper-1 failed ${r2.status}: ${msg}`);
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
      addLine(code, {
        ts: Date.now(),
        en: text,   // operator shows source text only
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    // surface error back to the UI (status is still 200 so we don’t kill the stream)
    return NextResponse.json({ ok: false, error: msg });
  }
}
