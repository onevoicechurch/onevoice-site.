// /app/api/ingest/route.js
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';
import { addLine, getSession } from '../_lib/sessionStore';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Drop tiny blobs (they often look “corrupt” to the API)
const MIN_BYTES = 6000;

// Always give OpenAI a real filename+extension and a simple audio type
async function makeFile(ab) {
  // Force a plain webm every time — avoids “invalid format” fussiness
  const blob = new Blob([ab], { type: 'audio/webm' });
  return toFile(blob, 'clip.webm');
}

function langHint(inputLang) {
  if (!inputLang || inputLang.toUpperCase() === 'AUTO') return undefined;
  return inputLang.split('-')[0]; // en-US -> en
}

async function transcribeWithFallback(file, language) {
  // 1) Try 4o-mini-transcribe
  try {
    const r1 = await openai.audio.transcriptions.create({
      model: 'gpt-4o-mini-transcribe',
      file,
      ...(language ? { language } : {}),
    });
    const t1 = (r1?.text || '').trim();
    if (t1) return t1;
  } catch (_) {
    // fall through
  }
  // 2) Fallback whisper-1 (more forgiving)
  const r2 = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    ...(language ? { language } : {}),
  });
  return (r2?.text || '').trim();
}

async function translateAll(text, targets) {
  if (!targets.length) return {};
  const pairs = await Promise.all(
    targets.map(async (lang) => {
      try {
        const r = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0.2,
          messages: [
            { role: 'system', content: `Translate to ${lang}. Return only the translation.` },
            { role: 'user', content: text },
          ],
        });
        const out = (r?.choices?.[0]?.message?.content || '').trim();
        return [lang, out];
      } catch {
        return [lang, ''];
      }
    })
  );
  return Object.fromEntries(pairs);
}

export async function POST(req) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code') || '';
    const inputLang = url.searchParams.get('inputLang') || 'AUTO';
    const langsCsv = url.searchParams.get('langs') || 'es';
    const targets = langsCsv.split(',').map(s => s.trim()).filter(Boolean);

    if (!OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: 'Missing OPENAI_API_KEY' }, { status: 500 });
    }
    const session = getSession(code);
    if (!code || !session) {
      return NextResponse.json({ ok: false, error: 'No such session' }, { status: 404 });
    }

    const ab = await req.arrayBuffer();
    if ((ab.byteLength || 0) < MIN_BYTES) {
      return NextResponse.json({ ok: true, skipped: 'tiny' });
    }

    // ✅ Force a proper File: clip.webm
    const file = await makeFile(ab);
    const language = langHint(inputLang);

    let englishText = '';
    try {
      englishText = await transcribeWithFallback(file, language);
    } catch (e) {
      addLine(code, {
        ts: Date.now(),
        en: `[transcribe error] ${(e?.message || '').slice(0, 180)}`,
        tx: Object.fromEntries(targets.map(t => [t, ''])),
      });
      return NextResponse.json({ ok: false, error: 'transcription_failed' }, { status: 502 });
    }

    if (!englishText) {
      return NextResponse.json({ ok: true, empty: true });
    }

    const translations = await translateAll(englishText, targets);
    addLine(code, { ts: Date.now(), en: englishText, tx: translations });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('ingest fatal', err);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
