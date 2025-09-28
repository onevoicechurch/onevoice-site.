import OpenAI from "openai";
import { NextResponse } from "next/server";
import { addLine, getSession } from "../_lib/sessionStore";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// We accept small audio chunks (webm/ogg) and a target language, then:
// 1) transcribe with OpenAI
// 2) translate with OpenAI
// 3) broadcast to listeners via addLine()
export async function POST(req) {
  const contentType = req.headers.get("content-type") || "";
  const url = new URL(req.url);
  const code = url.searchParams.get("code");      // session code
  const lang = url.searchParams.get("lang") || "es"; // operator's default target
  if (!code || !getSession(code)) {
    return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 400 });
  }

  // Expect raw audio blob
  const audioArrayBuffer = await req.arrayBuffer();
  const audioBuffer = Buffer.from(audioArrayBuffer);

  try {
    // 1) Transcribe ( Whisper via file upload API )
    const file = await openai.files.create({
      file: new File([audioBuffer], "chunk.webm", { type: contentType || "audio/webm" }),
      purpose: "transcriptions",
    });

    const transcript = await openai.audio.transcriptions.create({
      file: file.id,
      model: "whisper-1",
      response_format: "text",
    });

    const text = (transcript || "").trim();
    if (!text) return NextResponse.json({ ok: true, empty: true });

    // 2) Translate
    const translationRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Translate user text into the requested language ONLY. Keep it concise; no commentary." },
        { role: "user", content: `Language: ${lang}\nText: ${text}` },
      ],
      temperature: 0.2,
    });

    const translated = translationRes.choices[0]?.message?.content?.trim() || "";

    // 3) Broadcast line (we keep both original + translated)
    const line = { ts: Date.now(), text, translated, lang };
    addLine(code, line);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
