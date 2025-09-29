// /app/api/ingest/route.js
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { addLine, getSession } from '@/app/api/_lib/sessionStore';

const MIN_BYTES = 3500; // drop tiny blobs
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Try 4o-mini-transcribe first, fall back to whisper-1 if the API says format/corruption.
async function transcribeWithFallback(ab, contentType, inputLang) {
  const ext =
    contentType?.includes('wav') ? 'wav' :
    contentType?.includes('mp3') ? 'mp3' :
    contentType?.includes('ogg') ? 'ogg' :
    contentType?.includes('m4a') ? 'm4a' : 'webm';

  const file = new Blob([ab], { type: contentType || 'audio/webm' });

  // 1) 4o-mini-transcribe
  {
    const fd = new FormData();
    fd.append('file', file, `clip.${ext}`);
    fd.append('model', 'gpt-4o-mini-transcribe');
    if (inputLang && inputLang !== 'AUTO') {
      const primary = inputLang.split('-')[0];
      fd.append('language', primary);
    }

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: fd,
    });

    if (r.ok) return (await r.json())?.text?.trim() || '';

    // If it looks like a format/corruption 400, we’ll try whisper-1 next
    if (r.status !== 400) {
      const t = await r.text().catch(() => '');
      throw new Error(`transcribe failed (${r.status}): ${t}`);
    }
  }

  // 2) whisper-1
  const fd2 = new FormData();
  fd2.append('file', file, `clip.${ext}`);
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
    const t = await r2.text().catch(() => '');
    throw new Error(`whisper-1 failed (${r2.status}): ${t}`);
  }
  return (await r2.json())?.text?.trim() || '';
}

async function translateAll(englishText, targets) {
  const results = await Promise.all(
    targets.map(async (lang) => {
      const prompt = `Translate the following into ${lang}. Return only the translation:\n\n${englishText}`;
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!r.ok) return [lang, ''];
      const j = await r.json();
      return [lang, (j?.choices?.[0]?.message?.content || '').trim()];
    })
  );
  return Object.fromEntries(results);
}

export async function POST(req) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code') || '';
    const inputLang = url.searchParams.get('inputLang') || 'AUTO';
    const langsCsv = url.searchParams.get('langs') || 'es';
    const targetLangs = langsCsv.split(',').map((s) => s.trim()).filter(Boolean);

    // Validate session & key
    const session = getSession(code);
    if (!code || !session) {
      return NextResponse.json({ ok: false, error: 'No such session' }, { status: 404 });
    }
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: 'Missing OPENAI_API_KEY' }, { status: 500 });
    }

    // Read audio
    const ab = await req.arrayBuffer();
    const bytes = ab.byteLength || 0;
    if (bytes < MIN_BYTES) {
      // too tiny -> drop quietly to avoid noisy 400s
      return NextResponse.json({ ok: true, skipped: 'tiny' });
    }
    const contentType = req.headers.get('content-type') || 'audio/webm';

    // Transcribe (with fallback)
    let englishText = '';
    try {
      englishText = await transcribeWithFallback(ab, contentType, inputLang);
    } catch (e) {
      // Tell the operator what happened
      addLine(code, {
        ts: Date.now(),
        en: `[transcribe error] ${(e?.message || '').slice(0, 180)}`,
        tx: Object.fromEntries(targetLangs.map((l) => [l, ''])),
      });
      return NextResponse.json({ ok: false, error: 'transcription_failed' }, { status: 502 });
    }

    if (!englishText) {
      // silence/no speech
      return NextResponse.json({ ok: true, empty: true });
    }

    // Translate
    const translations = await translateAll(englishText, targetLangs);

    // Broadcast
    addLine(code, { ts: Date.now(), en: englishText, tx: translations });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('ingest fatal', err);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
