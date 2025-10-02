import { NextResponse } from 'next/server';
import { kv, appendLog } from '../_lib/kv';

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
// model that supports auto-language: nova-2-general
const DG_ENDPOINT = 'https://api.deepgram.com/v1/listen';

export const runtime = 'nodejs';

// Client posts: RAW AUDIO BYTES in body (NOT multipart), header: x-audio-mime
export async function POST(req) {
  try {
    const { searchParams } = new URL(req.url);
    const code = (searchParams.get('code') || '').toUpperCase();
    const lang = (searchParams.get('lang') || 'AUTO');

    if (!code) {
      return NextResponse.json({ ok: false, error: 'MISSING_CODE' }, { status: 400 });
    }

    // If this is just a “tick”/flush with no audio, exit quickly
    const contentType = req.headers.get('content-type') || '';
    const isJson = contentType.startsWith('application/json');
    if (isJson) {
      const payload = await req.json().catch(() => ({}));
      if (payload && (payload.tick || payload.final)) {
        return NextResponse.json({ ok: true, flush: true });
      }
    }

    // Read raw bytes and MIME the client observed
    const mime = req.headers.get('x-audio-mime') || 'audio/webm;codecs=opus';
    const audioBuffer = Buffer.from(await req.arrayBuffer());
    if (!audioBuffer.length) {
      return NextResponse.json({ ok: false, error: 'EMPTY_AUDIO' }, { status: 400 });
    }

    // Build DG URL & headers
    const qs = new URLSearchParams({
      model: 'nova-2-general',
      smart_format: 'true',
    });
    // Only send language if a specific one was chosen
    if (lang && lang !== 'AUTO') qs.set('language', lang);

    const dgRes = await fetch(`${DG_ENDPOINT}?${qs.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': mime
      },
      body: audioBuffer
    });

    const dgText = await dgRes.text();
    if (!dgRes.ok) {
      // Helpful debug back to client
      return NextResponse.json(
        { ok: false, error: `Deepgram error ${dgRes.status}: ${dgText}` },
        { status: 400 }
      );
    }

    const dg = JSON.parse(dgText);
    // pick the best transcript available (DG returns alternatives array)
    let text = '';
    try {
      text = dg?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
    } catch {}
    if (text) {
      await appendLog(code, text);
      await kv.set(`onevoice:latest:${code}`, { text, lang: (lang === 'AUTO' ? 'auto' : lang), t: Date.now() });
    }

    return NextResponse.json({ ok: true, text });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
