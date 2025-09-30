import { NextResponse } from 'next/server';
import { addLine, getSession } from '../_lib/sessionStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Drop too-tiny blobs
const MIN_BYTES = 3500;

export async function POST(req) {
  try {
    const url = new URL(req.url);
    const code = (url.searchParams.get('code') || '').toUpperCase();
    const inputLang = url.searchParams.get('inputLang') || 'AUTO';

    if (!code || !getSession(code)) {
      return NextResponse.json({ ok: false, error: 'invalid code' }, { status: 400 });
    }

    const contentType = req.headers.get('content-type') || '';
    const ab = await req.arrayBuffer();
    if (!ab || ab.byteLength < MIN_BYTES) {
      return NextResponse.json({ ok: true, skipped: 'tiny' });
    }

    // 1) Try the new 4o-mini-transcribe endpoint first
    let text = '';
    try {
      const file = new Blob([ab], { type: contentType || 'audio/webm' });
      const fd = new FormData();
      fd.append('file', file, `clip.${guessExt(contentType)}`);
      fd.append('model', 'gpt-4o-mini-transcribe');
      if (inputLang && inputLang !== 'AUTO') {
        // turn "en-US" -> "en"
        fd.append('language', (inputLang.split('-')[0] || 'en'));
      }
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: fd,
      });
      if (!r.ok) {
        const errTxt = await r.text().catch(()=>'');
        throw new Error(`4o-mini-transcribe failed (${r.status}): ${errTxt}`);
      }
      const j = await r.json();
      text = (j?.text || '').trim();
    } catch (e) {
      // 2) Fallback to whisper-1 if needed
      const file = new Blob([ab], { type: contentType || 'audio/webm' });
      const fd = new FormData();
      fd.append('file', file, `clip.${guessExt(contentType)}`);
      fd.append('model', 'whisper-1');
      if (inputLang && inputLang !== 'AUTO') {
        fd.append('language', (inputLang.split('-')[0] || 'en'));
      }
      const r2 = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: fd,
      });
      if (!r2.ok) {
        const errTxt = await r2.text().catch(()=>'');
        throw new Error(`whisper-1 failed (${r2.status}): ${errTxt}`);
      }
      const j2 = await r2.json();
      text = (j2?.text || '').trim();
    }

    if (text) {
      addLine(code, {
        ts: Date.now(),
        who: 'mic',
        text,
      });
    }

    return NextResponse.json({ ok: true, bytes: ab.byteLength, textLen: text.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

function guessExt(ct) {
  if (!ct) return 'webm';
  if (ct.includes('webm')) return 'webm';
  if (ct.includes('ogg')) return 'ogg';
  if (ct.includes('mp3')) return 'mp3';
  if (ct.includes('wav')) return 'wav';
  if (ct.includes('m4a')) return 'm4a';
  if (ct.includes('flac')) return 'flac';
  return 'webm';
}
