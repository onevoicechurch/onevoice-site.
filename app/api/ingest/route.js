// app/api/ingest/route.js
import { NextResponse } from 'next/server';
import { kv, appendLog } from '../_lib/kv';

export const runtime = 'nodejs'; // we need Node for Buffer

// Adjust these as you like
const DG_MODEL = 'nova-2';
const DG_BASE = 'https://api.deepgram.com/v1/listen';

function langQuery(inputLang) {
  // Deepgram: omit language to auto-detect; otherwise send ISO code like 'en', 'es'
  if (!inputLang) return '';
  return `&language=${encodeURIComponent(inputLang)}`;
}

export async function POST(req) {
  try {
    // Two modes:
    // 1) multipart/form-data with 'audio' (preferred)
    // 2) JSON ping (flush/keepalive)
    const ctype = req.headers.get('content-type') || '';

    if (ctype.includes('application/json')) {
      const body = await req.json().catch(() => ({}));
      const code = (body.code || '').toString().toUpperCase();
      if (!code) return NextResponse.json({ ok: false, error: 'MISSING_CODE' }, { status: 400 });
      // No audio → nothing to forward; you might force a flush to listeners here if you want
      return NextResponse.json({ ok: true });
    }

    if (!ctype.includes('multipart/form-data')) {
      return NextResponse.json({ ok: false, error: 'UNSUPPORTED_CONTENT_TYPE' }, { status: 415 });
    }

    const form = await req.formData();
    const file = form.get('audio');
    const code = (form.get('code') || '').toString().toUpperCase();
    const lang = (form.get('lang') || '').toString();

    if (!code || !file) {
      return NextResponse.json({ ok: false, error: 'MISSING_CODE_OR_AUDIO' }, { status: 400 });
    }

    // Convert Blob to Node Buffer
    const arrayBuf = await file.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const contentType = file.type || 'audio/wav';

    // Forward to Deepgram REST
    const url = `${DG_BASE}?model=${encodeURIComponent(DG_MODEL)}&smart_format=true&punctuate=true${langQuery(lang)}`;
    const dg = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
        'Content-Type': contentType,       // 'audio/wav'
        'Accept': 'application/json',
      },
      body: buf,
    });

    if (!dg.ok) {
      const txt = await dg.text().catch(() => '');
      return NextResponse.json(
        { ok: false, error: `Deepgram error ${dg.status}: ${txt}` },
        { status: 502 }
      );
    }

    const data = await dg.json().catch(() => null);
    // Pull transcript text (DG standard fields)
    const text =
      data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ||
      data?.results?.alternatives?.[0]?.transcript ||
      '';

    if (text) {
      // store for listeners (your existing fan-out via /api/stream)
      await appendLog(code, text);
      await kv.set(`onevoice:latest:${code}`, { text, t: Date.now(), lang: lang || 'auto' });
    }

    return NextResponse.json({ ok: true, text });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
