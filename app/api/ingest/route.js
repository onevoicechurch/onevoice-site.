// app/api/ingest/route.js
import { NextResponse } from 'next/server';
import { kv, appendLog } from '../_lib/kv';

export const runtime = 'nodejs';

const DG_URL_BASE = 'https://api.deepgram.com/v1/listen';

// Map incoming UI values to Deepgram language param
function mapLang(v) {
  if (!v) return 'multi';
  const s = String(v).trim().toLowerCase();
  if (s === 'auto' || s === 'auto-detect' || s === 'detect') return 'multi';
  return s; // e.g., 'en', 'es', 'pt', 'fr', 'de', ...
}

export async function POST(req) {
  try {
    const { searchParams } = new URL(req.url);
    const code = (searchParams.get('code') || '').toUpperCase();
    const langParam = mapLang(searchParams.get('lang'));

    if (!code) {
      return NextResponse.json({ ok: false, error: 'MISSING_CODE' }, { status: 400 });
    }

    // grab raw audio bytes from MediaRecorder (webm/opus)
    const audio = await req.arrayBuffer();
    if (!audio || audio.byteLength === 0) {
      return NextResponse.json({ ok: false, error: 'EMPTY_AUDIO' }, { status: 400 });
    }

    // Build Deepgram request: nova-2 + language=multi|en|es...
    const dgUrl = `${DG_URL_BASE}?model=nova-2&smart_format=true&language=${encodeURIComponent(langParam)}`;

    const dgRes = await fetch(dgUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
        'Content-Type': 'audio/webm;codecs=opus'
      },
      body: audio
    });

    if (!dgRes.ok) {
      const text = await dgRes.text().catch(() => '');
      return NextResponse.json(
        { ok: false, error: `Deepgram error ${dgRes.status}: ${text}` },
        { status: 400 }
      );
    }

    const dg = await dgRes.json().catch(() => ({}));

    // Pull a best-effort transcript string
    let text = '';
    try {
      // JSON shape varies slightly by endpoint; these two cover current nova-2 responses
      text =
        dg?.results?.channels?.[0]?.alternatives?.[0]?.transcript ||
        dg?.channel?.alternatives?.[0]?.transcript ||
        '';
    } catch {}
    text = (text || '').trim();

    if (!text) {
      return NextResponse.json({ ok: true, text: '' }); // nothing spoken in this chunk
    }

    // Store and fan out
    await appendLog(code, text);
    await kv.set(`onevoice:latest:${code}`, { text, lang: langParam, t: Date.now() });

    return NextResponse.json({ ok: true, text });
  } catch (err) {
    console.error('INGEST_CRASH', err);
    return NextResponse.json({ ok: false, error: 'INGEST_CRASH' }, { status: 500 });
  }
}
