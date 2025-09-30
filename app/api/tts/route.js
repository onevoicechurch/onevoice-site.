import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const { text, voiceId, modelId = "eleven_flash_v2_5" } = await req.json();

    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability: 0.7, similarity_boost: 0.7 }
      }),
    });

    if (!r.ok) {
      throw new Error(`TTS failed: ${r.statusText}`);
    }

    const arrayBuffer = await r.arrayBuffer();
    return new NextResponse(arrayBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": arrayBuffer.byteLength.toString(),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
