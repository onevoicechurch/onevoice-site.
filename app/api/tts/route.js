export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;

// POST { text, voiceId, modelId? }
export async function POST(req) {
  try {
    if (!ELEVEN_API_KEY) {
      return NextResponse.json({ ok: false, error: 'Missing ELEVENLABS_API_KEY' }, { status: 500 });
    }
    const body = await req.json();
    const text = (body?.text || '').trim();
    const voiceId = body?.voiceId;
    const modelId = body?.modelId || 'eleven_flash_v2_5';

    if (!text || !voiceId) {
      return NextResponse.json({ ok: false, error: 'Missing text or voiceId' }, { status: 400 });
    }

    // ElevenLabs TTS
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVEN_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        model_id: modelId,
        text,
        voice_settings: {
          // sensible defaults—feel free to tweak
          stability: 0.5,
          similarity_boost: 0.85,
          style: 0.2,
          use_speaker_boost: true,
        },
        optimize_streaming_latency: 0, // full quality
        output_format: 'mp3_44100_128',
      }),
    });

    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return NextResponse.json({ ok: false, error: 'TTS failed', detail: t.slice(0, 400) }, { status: 502 });
    }

    const ab = await r.arrayBuffer();
    return new NextResponse(Buffer.from(ab), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'server_error' }, { status: 500 });
  }
}
