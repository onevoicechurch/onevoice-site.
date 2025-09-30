export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const { text, voiceId, modelId = 'eleven_flash_v2_5' } = await req.json();

    if (!text || !voiceId) {
      return NextResponse.json({ error: 'Missing text or voiceId' }, { status: 400 });
    }

    const API = process.env.ELEVENLABS_API_KEY;
    if (!API) {
      return NextResponse.json({ error: 'ELEVENLABS_API_KEY not set' }, { status: 500 });
    }

    // ElevenLabs “stream” endpoint → lower latency, MP3 payload
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
      voiceId
    )}/stream?optimize_streaming_latency=3`;

    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': API,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId, // "eleven_flash_v2_5" by default (cheap + quick)
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          style: 0.3,
          use_speaker_boost: true,
        },
      }),
    });

    if (!r.ok) {
      const msg = await r.text().catch(() => '');
      return NextResponse.json(
        { error: 'TTS failed', details: msg?.slice(0, 400) },
        { status: 502 }
      );
    }

    const buf = await r.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
