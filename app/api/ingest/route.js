// /app/api/ingest/route.js
// Receives mic audio, transcribes (4o-mini-transcribe → fallback whisper-1),
// translates, and broadcasts to listeners.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';
import { addLine, getSession } from '../_lib/sessionStore'; // <-- relative path (one level up)

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// drop tiny blobs (they often cause “invalid/corrupt” and cost money)
const MIN_BYTES = 3500;

function langHint(inputLang) {
  if (!inputLang || inputLang.toUpperCase() === 'AUTO') return undefined;
  return inputLang.split('-')[0]; // "en-US" -> "en"
}

function pickExt(contentType = '') {
  const ct = contentType.toLowerCase();
  if (ct.includes('wav')) return 'wav';
  if (ct.includes('mp3') || ct.includes('mpga') || ct.includes('mpeg')) return 'mp3';
  if (ct.includes('m4a')) return 'm4a';
  if (ct.includes('ogg') || ct.includes('oga')) return 'ogg';
  if (ct.includes('mp4')) return 'mp4';
  if (ct.includes('webm')) return 'webm';
  return 'webm';
}

async function transcribeWithSDK(file, language) {
  // 1) try 4o-mini-transcribe
  try {
    const r1 = await openai.audio.transcriptions.create({
      model: 'gpt-4o-mini-transcribe',
      file,
      ...(language ? { language } : {}),
    });
    const text = (r1?.text || '').trim();
    if (text) return text;
  } catch (e) {
    // fall through to whisper-1
  }

  // 2) whisper-1 (more tolerant)
  const r2 = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    ...(language ? { language } : {}),
  });
  return (r2?.text || '').trim();
}

async function translateAll(text, targets) {
  if (!targets.length) return {};
  const results = await Promise.all(
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
        return [lang, (r?.choices?.[0]?.message?.content || '').trim()];
      } catch {
        return [lang, ''];
      }
    })
  );
  return Object.fromEntries(results);
}

export async function POST(req) {
  try {
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: 'Missing OPENAI_API_KEY' }, { status: 500 });
    }

    const url = new URL(req.url);
    const code = url.searchParams.get('code') || '';
    const inputLang = url.searchParams.get('inputLang') || 'AUTO';
    const langsCsv = url.searchParams.get('langs') || 'es';
    const targets = langsCsv.split(',').map(s => s.trim()).filter(Boolean);

    const session = getSession(code);
    if (!code || !session) {
      return NextResponse.json({ ok: false, error: 'No such session' }, { status: 404 });
    }

    const ab = await req.arrayBuffer();
    const bytes = ab.byteLength || 0;
    if (bytes < MIN_BYTES) {
      return NextResponse.json({ ok: true, skipped: 'tiny' });
    }

    const contentType = req.headers.get('content-type') || 'audio/webm';
    const ext = pickExt(contentType);
    const language = langHint(inputLang);

    // IMPORTANT: build a real File with a filename so OpenAI knows the format
    const blob = new Blob([ab], { type: contentType });
    const file = await toFile(blob, `clip.${ext}`);

    // transcribe with SDK (auto-fallback)
    let englishText = '';
    try {
      englishText = await transcribeWithSDK(file, language);
    } catch (e) {
      // show a one-line diagnostic in Operator UI
      addLine(code, {
        ts: Date.now(),
        en: `[transcribe error] ${(e?.message || '').slice(0, 160)}`,
        tx: Object.fromEntries(targets.map(t => [t, ''])),
      });
      return NextResponse.json({ ok: false, error: 'transcription_failed' }, { status: 502 });
    }

    if (!englishText) {
      // nothing recognized (silence/noise)
      return NextResponse.json({ ok: true, empty: true });
    }

    // translate in parallel
    const translations = await translateAll(englishText, targets);

    // broadcast to listeners
    addLine(code, { ts: Date.now(), en: englishText, tx: translations });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('ingest fatal', err);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
