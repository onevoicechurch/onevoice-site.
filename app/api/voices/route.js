export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

export async function GET() {
  const API = process.env.ELEVENLABS_API_KEY;
  if (!API) {
    return NextResponse.json({ voices: [] }, { status: 200 });
  }

  try {
    const r = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': API },
      cache: 'no-store',
    });

    if (!r.ok) {
      return NextResponse.json({ voices: [] }, { status: 200 });
    }

    const j = await r.json();
    // Return only the bits we need
    const voices = (j?.voices || []).map(v => ({
      voice_id: v.voice_id,
      name: v.name,
    }));

    return NextResponse.json({ voices });
  } catch {
    return NextResponse.json({ voices: [] }, { status: 200 });
  }
}
