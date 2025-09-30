import { NextResponse } from 'next/server';
import { appendLine } from '@/app/api/_lib/sessionStore';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req) {
  try {
    const url = new URL(req.url);
    const code = (url.searchParams.get('code') || '').toString().trim().slice(0, 8);
    const inputLang = (url.searchParams.get('inputLang') || '').toString().trim(); // optional hint
    if (!code) return NextResponse.json({ ok: false, error: 'missing code' }, { status: 400 });

    // Read finalized audio blob
    const type = req.headers.get('content-type') || 'audio/webm';
    const buf = Buffer.from(await req.arrayBuffer());
    if (!buf.length) return NextResponse.json({ ok: false, error: 'empty body' }, { status: 400 });

    // Name with proper extension so Whisper is happy
    const ext = type.includes('ogg') ? 'ogg'
              : type.includes('webm') ? 'webm'
              : type.includes('mp3') ? 'mp3'
              : type.includes('m4a') ? 'm4a'
              : type.includes('wav') ? 'wav'
              : 'webm';

    const file = new File([buf], `chunk.${ext}`, { type });

    // Transcribe
    const resp = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: inputLang || undefined, // let auto-detect unless operator picked one
      response_format: 'verbose_json',
      temperature: 0,
    });

    const text = (resp?.text || '').trim();
    if (text) appendLine(code, text);

    return NextResponse.json({ ok: true, text });
  } catch (e) {
    console.error('ingest error', e);
    return NextResponse.json({ ok: false, error: 'transcribe_failed' }, { status: 500 });
  }
}
