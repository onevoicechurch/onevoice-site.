export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { addLine } from '../_lib/sessionStore';

// drop tiny/empty blobs
const MIN_BYTES = 3500;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * Try 4o-mini-transcribe first; if the API says format/corruption (400),
 * fall back to whisper-1.
 */
async function transcribeWithFallback(ab, contentType, inputLang) {
  const ext =
    contentType?.includes('wav') ? 'wav' :
    contentType?.includes('mp3') ? 'mp3' :
    contentType?.includes('ogg') ? 'ogg' :
    contentType?.includes('m4a') ? 'm4a' :
    'webm';

  const file = new Blob([ab], { type: contentType || 'audio/webm' });

  // --- 4o-mini-transcribe ---
  const fd = new FormData();
  fd.append('file', file, `clip.${ext}`);
  fd.append('model', 'gpt-4o-mini-transcribe');
  if (inputLang && inputLang !== 'AUTO') {
    // accept either "en-US" or "en"
    const primary = inputLang.split('-')[0];
    fd.append('language', primary);
  }

  let r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: fd,
  });

  if (r.ok) {
    return (await r.json())?.text?.trim() || '';
  }

  // If it’s a 400 (format/corruption), try whisper-1 next
  if (r.status === 400) {
    const t = await r.text().catch(() => '');
    console.warn('4o-mini-transcribe 400; falling back to whisper-1:', t);

    const fd2 = new FormData();
    fd2.append('file', file, `clip.${ext}`);
    fd2.append('model', 'whisper-1');
    if (inputLang && inputLang !== 'AUTO') {
      const primary = inputLang.split('-')[0];
      fd2.append('language', primary);
    }

    r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: fd2,
    });

    if (r.ok) {
      return (await r.json())?.text?.trim() || '';
    }
  }

  // otherwise throw original error text
  const errTxt = await r.text().catch(() => `${r.status}`);
  throw new Error(`transcribe failed (${r.status}): ${errTxt}`);
}

export async function POST(req) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code') || '';
    const inputLang = searchParams.get('inputLang') || 'AUTO';
    if (!code) return NextResponse.json({ ok: false, error: 'missing code' }, { status: 400 });

    const contentType = req.headers.get('content-type') || '';
    const ab = await req.arrayBuffer();
    if (!ab || ab.byteLength < MIN_BYTES) {
      return NextResponse.json({ ok: false, error: 'tiny blob' }, { status: 400 });
    }

    const text = await transcribeWithFallback(ab, contentType, inputLang);

    if (text) {
      // Emit a shape the UI will always understand
      addLine(code, {
        ts: Date.now(),
        text,               // generic field
        en: text,           // legacy/alias
        lang: inputLang     // for future use
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('ingest error', err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
