export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;

export async function GET() {
  try {
    if (!ELEVEN_API_KEY) {
      return NextResponse.json({ voices: [] });
    }
    const r = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': ELEVEN_API_KEY },
      cache: 'no-store',
    });
    if (!r.ok) return NextResponse.json({ voices: [] });

    const j = await r.json();
    // keep a small safe subset: public/shared voices only
    const voices = (j?.voices || []).map(v => ({
      voice_id: v.voice_id,
      name: v.name,
      language: v?.labels?.language || v?.language || 'unknown',
    }));
    return NextResponse.json({ voices });
  } catch {
    return NextResponse.json({ voices: [] });
  }
}
