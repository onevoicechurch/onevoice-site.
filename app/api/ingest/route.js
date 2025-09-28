import OpenAI from "openai";
import { NextResponse } from "next/server";
import { addLine, getSession } from "../_lib/sessionStore";

export const runtime = "nodejs"; // needs Node for Buffer/File

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");          // session code, required
  const inputLang = url.searchParams.get("inputLang") || "AUTO"; // e.g., en-US or AUTO
  // langs to translate into (csv of BCP-47 or ISO-ish 2-letter: "es,vi,zh")
  const langs = (url.searchParams.get("langs") || "es").split(",").map(s => s.trim()).filter(Boolean);

  if (!code || !getSession(code)) {
    return NextResponse.json({ ok: false, error: "Invalid session code" }, { status: 400 });
  }

  // Expect raw audio in body (webm/ogg), use content-type as a hint
  const contentType = req.headers.get("content-type") || "audio/webm";
  const abuf = await req.arrayBuffer();
  const buf = Buffer.from(abuf);

  try {
    // --- 1) Transcription (Whisper) ---
    // Upload the chunk as a File; whisper can accept a language hint (like "en")
    const langHint = inputLang && inputLang !== "AUTO" ? inputLang.split("-")[0] : undefined;

    const file = await openai.files.create({
      file: new File([buf], "chunk.webm", { type: contentType }),
      purpose: "transcriptions",
    });

    const trans = await openai.audio.transcriptions.create({
      file: file.id,
      model: "whisper-1",
      // language: langHint, // uncomment to force language; leave undefined for auto-detect
      response_format: "text"
    });

    const enText = (trans || "").trim();
    if (!enText) return NextResponse.json({ ok: true, empty: true });

    // --- 2) Translate to requested languages (server-side, one time) ---
    async function translateTo(code2) {
      const sys = `Translate this English text into ${code2}. Output only the translation.`;
      const r = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: enText }
        ],
        temperature: 0.2,
      });
      return (r.choices?.[0]?.message?.content || "").trim();
    }

    const tx = {};
    for (const lc of langs) {
      tx[lc] = await translateTo(lc);
    }

    // --- 3) Broadcast one payload to all listeners ---
    const line = { ts: Date.now(), en: enText, tx };
    addLine(code, line);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
