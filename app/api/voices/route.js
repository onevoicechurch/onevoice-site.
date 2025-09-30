import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch voices: ${res.statusText}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
