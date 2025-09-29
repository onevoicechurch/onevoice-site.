// app/api/ingest/route.js  (PRODUCTION: real transcription + translation)
import { NextResponse } from "next/server";
import { addLine, getSession } from "../../_lib/sessionStore";

// ---- CONFIG ----
// Speech-to-text model (fast + good): try "gpt-4o-mini-transcribe" if available.
// Fallback to "whisper-1" if your account doesn't have the newer model.
const STT_MODEL = process.env.OV_STT_MODEL || "whisper-1";
// Text translation model:
const TRANSLATE_MODEL = process.env.OV_TX_MODEL || "gpt-4o-mini";
// --------------

// Keep on Node runtime (NOT edge) since we post multipart to OpenAI
export const runtime = "node";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code") || "";
    const inputLang = url.searchParams.get("inputLang") || "AUTO";
    const langs =
      (url.searchParams.get("langs") || "es")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    const session = getSession(code);
    if (!session) {
      return NextResponse.json({ ok: false, error: "No such session" }, { status: 404 });
    }

    // Read mic chunk
    const ab = await req.arrayBuffer();
    const bytes = ab.byteLength || 0;
    if (bytes < 1500) {
      // ignore tiny/noise chunks to save $$
      return NextResponse.json({ ok: true, skipped: "small chunk" });
    }

    // ---- 1) TRANSCRIBE (speech -> English text) ----
    // Build multipart/form-data for OpenAI /audio/transcriptions
    const form = new FormData();
    const file = new Blob([ab], { type: req.headers.get("content-type") || "audio/webm" });
    form.append("file", file, "chunk.webm");
    form.append("model", STT_MODEL);

    // If you *know* the spoken language (e.g., "en", "es", "vi"), you can hint it:
    // - whisper-1 uses "language" (ISO-639-1 like "en", "es")
    // - gpt-4o-mini-transcribe auto-detects; we keep a hint for whisper-1 only
    if (STT_MODEL === "whisper-1" && inputLang && inputLang !== "AUTO") {
      // extract primary code like "en" from "en-US"
      const hint = inputLang.split("-")[0].toLowerCase();
      form.append("language", hint);
    }

    const sttRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });

    if (!sttRes.ok) {
      const errText = await sttRes.text();
      console.error("STT error:", errText);
      return NextResponse.json({ ok: false, error: "stt_failed" }, { status: 502 });
    }

    const sttJson = await sttRes.json();
    const english = (sttJson.text || "").trim();
    if (!english) {
      return NextResponse.json({ ok: true, note: "no speech detected" });
    }

    // ---- 2) TRANSLATE (English -> each target language) ----
    const txMap = {};
    for (const l of langs) {
      try {
        // Ask the model to ONLY return the translation, no extra text.
        const prompt = [
          {
            role: "system",
            content: `You are a translator. Translate the user's message into the target language specified. 
Return ONLY the translated sentence with no quotes or commentary.`,
          },
          {
            role: "user",
            content: `Target language: ${l}\nText: ${english}`,
          },
        ];

        const tRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: TRANSLATE_MODEL,
            messages: prompt,
            temperature: 0.2,
          }),
        });

        if (!tRes.ok) {
          const txErr = await tRes.text();
          console.error("TX error:", l, txErr);
          continue;
        }
        const tJson = await tRes.json();
        const out =
          tJson.choices?.[0]?.message?.content?.trim() ||
          "";
        if (out) txMap[l] = out;
      } catch (e) {
        console.error("translate catch:", l, e);
      }
    }

    // ---- 3) Broadcast to listeners (and show in Live Preview) ----
    const line = {
      ts: Date.now(),
      en: english,
      tx: txMap,
    };
    addLine(code, line);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("ingest error:", err);
    return NextResponse.json({ ok: false, error: "ingest_error" }, { status: 500 });
  }
}
