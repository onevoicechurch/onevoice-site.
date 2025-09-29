// /app/api/ingest/route.js
// Receives mic chunks, transcribes (4o-mini-transcribe → fallback whisper-1),
// translates, then broadcasts lines via the in-memory session store.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
// NOTE: path is from /app/api/ingest to /app/_lib/sessionStore.js
import { addLine, getSession } from '../../_lib/sessionStore';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MIN_BYTES = 8000; // ignore tiny or corrupt blobs

async function transcribeWith(model, ab, contentType, hintLang) {
  const ext =
    contentType?.includes('wav') ? 'wav' :
    contentType?.includes('mp3') ? 'mp3' :
    contentType?.includes('ogg') ? 'ogg' :
    contentType?.includes('m4a') ? 'm4a' :
    'webm';

  const form = new FormData();
  form.append('file', new Blob([ab], { type: contentType || 'audio/webm' }), `clip.${ext}`);
  form.append('model', model);
  if (hintLang && hintLang !== 'AUTO') {
    form.append('language', hintLang.split('-')[0]); // “en-US” → “en”
  }

  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  return r;
}

async function translateAll(text, targets) {
  if (!targets.length) return {};
  const body = {
    model: 'gpt-4o-mini',
    messages: targets.map((t) => ({
      role: 'user',
      content: `Translate into ${t}. Return only the translation:\n\n${text}`,
    })),
    temperature: 0.2,
  };
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) return Object.fromEntries(targets.map((t) => [t, '']));
  const j = await r.json().catch(() => ({}));
  // One message per target in order
  const out = {};
  targets.forEach((t, i) => {
    out[t] = (j?.choices?.[i]?.message?.content || '').trim();
  });
  return out;
}

export async function POST(req) {
  try {
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: 'Missing OPENAI_API_KEY' }, { status: 500 });
    }

    const url = new URL(req.url);
    const code = url.searchParams.get('code') || '';
    const inputLang = url.searchParams.get('inputLang') || 'AUTO';
    const targets = (url.searchParams.get('langs') || 'es')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const session = getSession(code);
    if (!session) {
      return NextResponse.json({ ok: false, error: 'No such session' }, { status: 404 });
    }

    const ab = await req.arrayBuffer();
    const bytes = ab.byteLength || 0;
    if (bytes < MIN_BYTES) {
      return NextResponse.json({ ok: true, skipped: 'tiny_chunk' });
    }

    const contentType = req.headers.get('content-type') || 'audio/webm';

    // Try 4o-mini-transcribe first (faster/cheaper), then fall back to whisper-1
    let txResp = await transcribeWith('gpt-4o-mini-transcribe', ab, contentType, inputLang);
    let usedModel = 'gpt-4o-mini-transcribe';

    if (!txResp.ok) {
      const errText = await txResp.text().catch(() => '');
      // Some accounts/models don’t like webm/opus. Try whisper-1 next.
      txResp = await transcribeWith('whisper-1', ab, contentType, inputLang);
      usedModel = 'whisper-1';

      if (!txResp.ok) {
        // Still show something in the console so you can see errors live
        addLine(code, {
          ts: Date.now(),
          en: `[transcribe error ${txResp.status}]`,
          tx: Object.fromEntries(targets.map((t) => [t, ''])),
        });
        return NextResponse.json(
          { ok: false, error: 'transcription_failed', detail: errText || (await txResp.text().catch(() => '')) },
          { status: 502 }
        );
      }
    }

    const txJson = await txResp.json().catch(() => ({}));
    const englishText = (txJson?.text || '').trim();

    if (!englishText) {
      return NextResponse.json({ ok: true, empty: true, model: usedModel });
    }

    const translations = await translateAll(englishText, targets);

    addLine(code, {
      ts: Date.now(),
      en: englishText,
      tx: translations,
    });

    return NextResponse.json({ ok: true, model: usedModel });
  } catch (err) {
    console.error('ingest fatal error', err);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
