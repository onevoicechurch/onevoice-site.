import { NextResponse } from 'next/server';
import { appendLineIfNewer } from '../_lib/sessionStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// OpenAI Whisper transcription
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req) {
  const u = new URL(req.url);
  const code = (u.searchParams.get('code') || '').toUpperCase();
  const inputLang = (u.searchParams.get('input') || 'auto').toLowerCase();
  const seqHeader = req.headers.get('x-seq');
  const seq = Number(seqHeader || 0);

  if (!code) return NextResponse.json({ ok: false, error: 'missing code' }, { status: 400 });
  if (!seq || Number.isNaN(seq)) return NextResponse.json({ ok: false, error: 'missing seq' }, { status: 400 });

  const ctype = req.headers.get('content-type') || '';
  if (!ctype.startsWith('audio/')) {
    return NextResponse.json({ ok: false, error: 'content-type' }, { status: 400 });
  }

  const ab = await req.arrayBuffer();
  if (!ab || ab.byteLength < 6000) {
    return NextResponse.json({ ok: false, error: 'empty-or-too-small' }, { status: 400 });
  }

  // Build a File for OpenAI SDK
  const ext = ctype.includes('ogg') ? 'ogg' : ctype.includes('webm') ? 'webm' : 'wav';
  const file = new File([new Uint8Array(ab)], `chunk.${ext}`, { type: ctype });

  // Transcribe with Whisper
  const resp = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: inputLang === 'auto' ? undefined : inputLang, // let whisper auto-detect if auto
    response_format: 'verbose_json',
    temperature: 0,
  });

  const text = (resp?.text || '').trim();
  if (!text) return NextResponse.json({ ok: true, ignored: 'no-text' });

  const { accepted } = await appendLineIfNewer(code, seq, text, resp?.language || null);
  return NextResponse.json({ ok: true, accepted, text });
}
