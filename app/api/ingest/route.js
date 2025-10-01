// app/api/ingest/route.js
import { NextResponse } from 'next/server';
import { kv, appendLog } from '../_lib/kv';

export const runtime = 'nodejs';

// --- helper: call Deepgram on a single audio chunk --------------------------
async function deepgramTranscribe(blob, lang) {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error('Missing DEEPGRAM_API_KEY');

  // Pick model + language
  // If you want auto-language, use language=multilingual
  const language = lang && lang !== 'AUTO' ? lang : 'multilingual';
  const model = 'nova-2-general'; // solid, low latency

  const res = await fetch(
    `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(model)}&language=${encodeURIComponent(language)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        // We recorded with MediaRecorder -> webm/opus
        'Content-Type': 'audio/webm',
        Accept: 'application/json'
      },
      body: blob
    }
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Deepgram error ${res.status}: ${txt}`);
  }

  const json = await res.json();
  // Defensive pulls across versions
  const alt =
    json?.results?.channels?.[0]?.alternatives?.[0] ??
    json?.channel?.alternatives?.[0];

  const transcript = alt?.transcript?.trim() || '';
  return transcript;
}

// --- main handler -----------------------------------------------------------
// Accepts EITHER:
// 1) multipart/form-data with fields: audio (Blob), code (string), lang (string?)
// 2) application/json with { code } -> a "flush ping" (no audio)
export async function POST(req) {
  try {
    const ctype = req.headers.get('content-type') || '';

    // --- JSON "flush" ping (no audio) --------------------------------------
    if (ctype.includes('application/json')) {
      const body = await req.json().catch(() => ({}));
      const code = (body?.code || '').toUpperCase();
      if (!code) {
        return NextResponse.json({ ok: false, error: 'MISSING_CODE' }, { status: 400 });
      }

      // For polling UIs, keep "latest"
      await kv.set(`onevoice:latest:${code}`, { text: '', lang: '', t: Date.now() });
      return NextResponse.json({ ok: true });
    }

    // --- Multipart with audio chunk ----------------------------------------
    if (ctype.includes('multipart/form-data')) {
      const form = await req.formData();
      const code = String(form.get('code') || '').toUpperCase();
      const lang = String(form.get('lang') || '');
      const audio = form.get('audio'); // this is a Blob

      if (!code || !audio) {
        return NextResponse.json({ ok: false, error: 'MISSING_CODE_OR_AUDIO' }, { status: 400 });
      }

      // Transcribe with Deepgram
      const text = await deepgramTranscribe(audio, lang);

      // If we got real text, fan it out
      if (text) {
        await appendLog(code, text);
        await kv.set(`onevoice:latest:${code}`, { text, lang, t: Date.now() });
      }

      return NextResponse.json({ ok: true, text });
    }

    // --- Unknown body type --------------------------------------------------
    return NextResponse.json({ ok: false, error: 'UNSUPPORTED_CONTENT_TYPE' }, { status: 415 });
  } catch (err) {
    // Make the failure visible in the Network "Response" pane
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 502 }
    );
  }
}
