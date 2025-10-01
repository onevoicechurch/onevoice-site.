export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { kv, auKey, evKey } from '../_lib/kv';
import { getInputLang } from '../_lib/sessionStore';

async function base64ToBuffer(b64) {
  return Buffer.from(b64, 'base64');
}

async function flushToDeepgram({ code, langHint }) {
  // Gather all chunks accumulated for this session
  const key = auKey(code);
  const len = await kv.llen(key);
  if (!len) return { ok:false, reason:'no-audio' };

  const chunks = await kv.lrange(key, 0, -1);
  await kv.del(key); // clear buffer after reading

  // Concatenate into a single webm buffer
  const parts = await Promise.all(chunks.map(base64ToBuffer));
  const audioBuf = Buffer.concat(parts);

  // Deepgram prerecorded transcription (fast, reliable)
  const url = new URL('https://api.deepgram.com/v1/listen');
  url.searchParams.set('model', 'nova-2-general');        // modern model
  url.searchParams.set('smart_format', 'true');
  url.searchParams.set('punctuate', 'true');
  url.searchParams.set('paragraphs', 'true');
  // Let Deepgram detect language; if you want to hint, set language or detect_language:
  url.searchParams.set('detect_language', 'true');
  if (langHint && langHint !== 'AUTO') {
    // optional language hint, e.g., 'en' or 'es'
    url.searchParams.set('language', langHint);
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
      'Content-Type': 'audio/webm'  // MediaRecorder default on Chrome
    },
    body: audioBuf
  });

  if (!resp.ok) {
    const t = await resp.text().catch(()=> '');
    return { ok:false, reason:`deepgram-${resp.status}`, body:t };
  }

  const dg = await resp.json().catch(()=> ({}));
  const alt = dg?.results?.channels?.[0]?.alternatives?.[0];
  const text = alt?.transcript?.trim() || '';
  const lang = alt?.language || 'auto';

  if (!text) return { ok:false, reason:'empty-transcript' };

  // Push event to listeners list
  await kv.rpush(evKey(code), JSON.stringify({
    ts: Date.now(),
    text,
    lang
  }));

  return { ok:true, text, lang };
}

export async function POST(req) {
  const { searchParams } = new URL(req.url);
  const code   = searchParams.get('code');
  const flush  = searchParams.get('flush') === '1';
  const final  = searchParams.get('final') === '1';

  if (!code) return NextResponse.json({ ok:false, error:'Missing code' }, { status:400 });

  try {
    if (!flush && !final) {
      // Append chunk
      const buf = Buffer.from(await req.arrayBuffer());
      if (buf.length > 0) {
        await kv.rpush(auKey(code), buf.toString('base64'));
      }
      return NextResponse.json({ ok:true, queued:true });
    }

    // Flush queued chunks to Deepgram (sentence boundary or mic stop)
    const langHint = await getInputLang(code);
    const r = await flushToDeepgram({ code, langHint });
    if (!r.ok && r.reason === 'no-audio') {
      return NextResponse.json({ ok:true, flushed:false });
    }
    if (!r.ok) {
      return NextResponse.json({ ok:false, error:r.reason }, { status:502 });
    }
    return NextResponse.json({ ok:true, flushed:true, text:r.text, lang:r.lang });

  } catch (e) {
    return NextResponse.json({ ok:false, error:String(e?.message||e) }, { status:500 });
  }
}
