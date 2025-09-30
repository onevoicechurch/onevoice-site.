import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Simple, low-latency translator. You can swap to a dedicated MT model later.
export async function POST(req) {
  try {
    const { text, target } = await req.json();
    if (!text || !target) {
      return NextResponse.json({ ok: false, error: 'missing text/target' }, { status: 400 });
    }
    const r = await openai.responses.create({
      model: 'gpt-4o-mini',
      input: `Translate to ${target}:\n\n${text}\n\nReturn only the translation.`,
      temperature: 0,
    });
    const out = r.output_text?.trim() || '';
    return NextResponse.json({ ok: true, text: out });
  } catch (e) {
    console.error('translate error', e);
    return NextResponse.json({ ok: false, error: 'translate_failed' }, { status: 500 });
  }
}
