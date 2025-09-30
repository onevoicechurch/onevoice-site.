// /app/api/speak/route.js
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const { text, voice = 'alloy', format = 'mp3' } = await req.json();

    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'Missing text' }, { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 });
    }

    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',     // OpenAI TTS
        input: text,
        voice,              // alloy, verse, sage, coral, etc.
        format,             // mp3 recommended
      }),
    });

    if (!r.ok) {
      const msg = await r.text().catch(() => '');
      return NextResponse.json({ error: msg || 'TTS failed' }, { status: 502 });
    }

    const audio = await r.arrayBuffer();
    return new Response(audio, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
