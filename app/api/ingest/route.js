import { NextResponse } from 'next/server';
import { addLine, getSession } from '@/app/api/_lib/sessionStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MIN_BYTES = 3500; // ignore tiny blobs

export async function POST(req) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json({ ok: false, error: 'OPENAI_API_KEY missing' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code')?.toUpperCase();
  const inputLang = (searchParams.get('inputLang') || 'AUTO').toUpperCase();

  if (!code || !getSession(code)) {
    return NextResponse.json({ ok: false, error: 'invalid code' }, { status: 400 });
  }

  const contentType = req.headers.get('content-type') || 'audio/webm';
  const ab = await req.arrayBuffer();
  if (!ab || ab.byteLength < MIN_BYTES) {
    return NextResponse.json({ ok: true, skipped: 'too small' });
  }

  // Try 4o-mini-transcribe first; fallback to Whisper-1 if format error
  async function transcribeWith(model) {
    const file = new Blob([ab], { type: contentType });
    const fd = new FormData();
    fd.append('file', file, `clip.${contentType.split('/')[1] || 'webm'}`);
    fd.append('model', model);
    if (inputLang && inputLang !== 'AUTO') {
      const primary = inputLang.split('-')[0];
      fd.append('language', primary);
    }

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: fd
    });

    const text = (await r.json())?.text?.trim?.() || '';
    if (!r.ok) {
      const msg = text || 'transcription failed';
      const err = new Error(msg);
      err.status = r.status;
      throw err;
    }
    return text;
  }

  let text = '';
  try {
    text = await transcribeWith('gpt-4o-mini-transcribe');
  } catch (e) {
    if (e?.status === 400) {
      // format/corruption — fallback to whisper-1
      text = await transcribeWith('whisper-1');
    } else {
      return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
    }
  }

  if (text) {
    // push a single "source" line for operator & listeners
    addLine(code, { type: 'src', text, at: Date.now() });
  }

  return NextResponse.json({ ok: true, bytes: ab.byteLength, text });
}
