// app/api/ingest/route.js
import { NextResponse } from 'next/server';
import { kv, appendLog } from '../_lib/kv';  // adjust path if yours differs

export const runtime = 'nodejs';

export async function POST(req) {
  try {
    const { searchParams } = new URL(req.url);
    const code = (searchParams.get('code') || '').toUpperCase();
    const lang = (searchParams.get('lang') || 'auto').trim(); // 'auto' or 'en', 'es', ...

    const ct = req.headers.get('content-type') || '';
    const isWav = ct.startsWith('audio/wav');

    // Allow empty JSON pings (flush ticks) without audio
    if (!isWav) {
      const maybeJson = await req.text().catch(()=> '');
      if (!maybeJson) {
        return NextResponse.json({ ok: false, error: 'UNSUPPORTED_CONTENT_TYPE' }, { status: 400 });
      }
      // No-op flush; you can handle if needed
      return NextResponse.json({ ok: true });
    }

    if (!code) {
      return NextResponse.json({ ok: false, error: 'MISSING_CODE' }, { status: 400 });
    }

    const wavBuffer = Buffer.from(await req.arrayBuffer());

    const params = new URLSearchParams({
      model: 'nova-2',
      smart_format: 'true',
    });
    // Deepgram language handling:
    // If 'auto', omit language; otherwise add language=<iso>
    if (lang && lang !== 'auto') params.set('language', lang);

    const dgRes = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        'Content-Type': 'audio/wav',
      },
      body: wavBuffer,
    });

    if (!dgRes.ok) {
      const text = await dgRes.text().catch(()=> '');
      return NextResponse.json(
        { ok: false, error: `Deepgram error ${dgRes.status}: ${text}` },
        { status: 502 }
      );
    }

    const json = await dgRes.json();
    // Extract best transcript (Deepgram JSON shape)
    const alt = json?.results?.channels?.[0]?.alternatives?.[0];
    const transcript = (alt?.transcript || '').trim();
    if (transcript) {
      await appendLog(code, transcript);
      await kv.set(`onevoice:latest:${code}`, { text: transcript, lang, t: Date.now() });
    }

    return NextResponse.json({ ok: true, text: transcript || '' });
  } catch (err) {
    console.error('INGEST ERROR', err);
    return NextResponse.json({ ok: false, error: 'INGEST_EXCEPTION' }, { status: 500 });
  }
}
