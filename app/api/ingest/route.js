import { NextResponse } from 'next/server';

export const runtime = 'nodejs'; 
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const inputLang = searchParams.get('inputLang') || 'en';

    if (!code) {
      return NextResponse.json({ error: 'Missing code' }, { status: 400 });
    }

    // Read binary audio
    const buf = Buffer.from(await req.arrayBuffer());

    if (!buf || buf.length === 0) {
      return NextResponse.json({ error: 'Empty audio' }, { status: 400 });
    }

    // 🔹 TODO: send `buf` to Whisper or store in your session pipeline
    console.log(`Got audio for session ${code}, bytes=${buf.length}, lang=${inputLang}`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
