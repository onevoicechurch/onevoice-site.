import { NextResponse } from 'next/server';

// If you use Upstash log fanout, keep this import.
// If not, it's harmless (we guard calls with try/catch).
import { kv, appendLog } from '../_lib/kv';

export const runtime = 'nodejs';

// Normalize the MIME for Deepgram – make codecs explicit.
function normalizeMime(input) {
  const m = (input || '').toLowerCase();
  if (m.includes('audio/ogg'))  return 'audio/ogg;codecs=opus';
  if (m.includes('audio/webm')) return 'audio/webm;codecs=opus';
  if (m.includes('audio/mpeg')) return 'audio/mpeg';
  if (m.includes('audio/wav'))  return 'audio/wav';
  return 'audio/webm;codecs=opus';
}

// Safely pull transcript text from Deepgram response
function extractText(json) {
  // nova-2 JSON (text) usually has results.channels[0].alternatives[0].transcript
  const ch = json?.results?.channels?.[0];
  const alt = ch?.alternatives?.[0];
  return alt?.transcript || '';
}

export async function POST(req) {
  try {
    // Two modes:
    // 1) multipart/form-data with audio + fields
    // 2) JSON ping { code } to prompt flush
    const ct = req.headers.get('content-type') || '';
    let code = '';
    let lang = '';
    let clientMime = '';
    let raw = null;

    if (ct.includes('multipart/form-data')) {
      const form = await req.formData();
      const f = form.get('audio');               // File
      code = String(form.get('code') || '').toUpperCase();
      lang = String(form.get('lang') || '').trim();
      clientMime = String(form.get('mime') || (f?.type || ''));

      if (!f || !code) {
        return NextResponse.json({ ok: false, error: 'MISSING_CODE_OR_AUDIO' }, { status: 400 });
      }
      const ab = await f.arrayBuffer();
      raw = Buffer.from(ab);
    } else if (ct.includes('application/json')) {
      const body = await req.json().catch(() => ({}));
      code = String(body.code || '').toUpperCase();
      lang = String(body.lang || '').trim();
      // no audio body → treat as flush tick (ok: true)
      if (!code) {
        return NextResponse.json({ ok: false, error: 'MISSING_CODE' }, { status: 400 });
      }
      return NextResponse.json({ ok: true, tick: true });
    } else {
      return NextResponse.json({ ok: false, error: 'UNSUPPORTED_CONTENT_TYPE' }, { status: 415 });
    }

    // Call Deepgram
    const mime = normalizeMime(clientMime);
    const params = new URLSearchParams({
      model: 'nova-2',
      smart_format: 'true',
    });

    if (lang && lang !== 'AUTO') {
      params.set('language', lang);
    } else {
      params.set('detect_language', 'true');
    }

    if (mime.startsWith('audio/webm') || mime.startsWith('audio/ogg')) {
      params.set('encoding', 'opus');
    }

    const dgRes = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        'Content-Type': mime,
      },
      body: raw,
    });

    const txt = await dgRes.text();
    if (!dgRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Deepgram error ${dgRes.status}: ${txt}`,
          debug: { sendType: mime, size: raw?.length || 0, lang: lang || 'auto' }
        },
        { status: 502 }
      );
    }

    const json = JSON.parse(txt);
    const transcript = (extractText(json) || '').trim();

    if (transcript) {
      try { await appendLog(code, transcript); } catch {}
    }

    return NextResponse.json({ ok: true, text: transcript });

  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
