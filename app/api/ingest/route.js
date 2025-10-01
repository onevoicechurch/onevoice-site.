// app/api/ingest/route.js
import { NextResponse } from 'next/server';
import { kv, appendLog } from '../_lib/kv';

export const runtime = 'nodejs';

const DG_URL_BASE = 'https://api.deepgram.com/v1/listen';

// Map UI language => Deepgram param
function mapLang(v) {
  if (!v) return 'multi';
  const s = String(v).trim().toLowerCase();
  if (s === 'auto' || s === 'auto-detect') return 'multi';
  return s; // 'en','es','pt','fr','de',...
}

export async function POST(req) {
  try {
    // Your operator posts multipart/form-data
    const fd = await req.formData().catch(() => null);

    // If it wasn’t multipart (flush ping), accept JSON too
    let code = '';
    let lang = 'multi';
    let audioBlob = null;

    if (fd) {
      code = String(fd.get('code') || '').toUpperCase();
      lang = mapLang(fd.get('lang') || '');
      audioBlob = fd.get('audio'); // Blob or File
    } else {
      const body = await req.json().catch(() => ({}));
      code = String(body.code || '').toUpperCase();
      lang = mapLang(body.lang || '');
      // no audio in flush pings
    }

    if (!code) {
      return NextResponse.json({ ok: false, error: 'MISSING_CODE' }, { status: 400 });
    }

    // If this is just a flush ping (no audio), nudge listeners and return OK
    if (!audioBlob) {
      await kv.set(`onevoice:latest:${code}`, { text: '', lang, t: Date.now() });
      return NextResponse.json({ ok: true, text: '' });
    }

    // Turn Blob -> ArrayBuffer for Deepgram
    const audioBuf = await audioBlob.arrayBuffer();

    // Call Deepgram (multilingual = language=multi)
    const dgUrl = `${DG_URL_BASE}?model=nova-2&smart_format=true&language=${encodeURIComponent(lang)}`;
    const dgRes = await fetch(dgUrl, {
      method: 'POST',
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        'Content-Type': 'audio/webm;codecs=opus',
      },
      body: audioBuf,
    });

    if (!dgRes.ok) {
      const text = await dgRes.text().catch(() => '');
      return NextResponse.json(
        { ok: false, error: `Deepgram error ${dgRes.status}: ${text}` },
        { status: 400 }
      );
    }

    const dg = await dgRes.json().catch(() => ({}));
    const text =
      dg?.results?.channels?.[0]?.alternatives?.[0]?.transcript ||
      dg?.channel?.alternatives?.[0]?.transcript ||
      '';

    if (text?.trim()) {
      await appendLog(code, text);
      await kv.set(`onevoice:latest:${code}`, { text, lang, t: Date.now() });
    }

    return NextResponse.json({ ok: true, text: text || '' });
  } catch (err) {
    console.error('INGEST_CRASH', err);
    return NextResponse.json({ ok: false, error: 'INGEST_CRASH' }, { status: 500 });
  }
}
