import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { addLine, isReady } from '../_lib/sessionStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Choose your ASR model here
const ASR_MODEL = 'gpt-4o-mini-transcribe'; // or 'whisper-1'

export async function POST(req) {
  try {
    const url = new URL(req.url);
    const code = (url.searchParams.get('code') || '').toUpperCase();
    if (!code || !isReady(code)) {
      return NextResponse.json({ ok: false, error: 'bad_code' }, { status: 400 });
    }

    const contentType = req.headers.get('content-type') || 'audio/webm';
    const ab = await req.arrayBuffer();
    if (!ab || ab.byteLength < 4000) {
      return NextResponse.json({ ok: false, error: 'audio_too_small' }, { status: 400 });
    }

    // Turn raw bytes into a File for the SDK
    const buf = Buffer.from(ab);
    const file = new File([buf], `chunk.${contentType.includes('ogg') ? 'ogg' : 'webm'}`, { type: contentType });

    // Transcribe
    const tr = await openai.audio.transcriptions.create({
      file,
      model: ASR_MODEL,
      // You can add language hints here later if desired: language: 'en'
    });

    const text = (tr?.text || '').trim();
    if (text) addLine(code, text);

    return NextResponse.json({ ok: true, text });
  } catch (e) {
    console.error('ingest error', e);
    return NextResponse.json({ ok: false, error: 'ingest_failed' }, { status: 500 });
  }
}
