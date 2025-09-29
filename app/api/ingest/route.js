// app/api/ingest/route.js
// Accepts small audio chunks from the Operator, transcribes with Whisper,
// translates with GPT, and pushes a line into the in-memory session store.

import { NextResponse } from "next/server";
import { getSession, addLine } from "../_lib/sessionStore";

export const runtime = "nodejs"; // we need Node (multipart/form-data, fetch to OpenAI)

// OPTIONAL: set a hard limit to keep chunks small (you’re sending ~1s chunks)
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(req) {
  try {
    // ----- Query params -----
    const url = new URL(req.url);
    const code = url.searchParams.get("code") || "";
    const inputLang = (url.searchParams.get("inputLang") || "AUTO").trim();
    const langsCsv = (url.searchParams.get("langs") || "es").trim();
    const targetLangs = langsCsv.split(",").map((s) => s.trim()).filter(Boolean);

    // Validate session
    const session = getSession(code);
    if (!code || !session) {
      return NextResponse.json({ ok: false, error: "No such session" }, { status: 404 });
    }

    // ----- Read audio -----
    const ab = await req.arrayBuffer();
    if (!ab || ab.byteLength === 0) {
      return NextResponse.json({ ok: false, error: "No audio data" }, { status: 400 });
    }
    if (ab.byteLength > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "Chunk too large" }, { status: 413 });
    }

    // ----- Transcribe with Whisper -----
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    // Build multipart form-data
    const form = new FormData();
    // Whisper expects a file; give it a name + MIME type (webm/ogg etc. both work if content matches)
    const blob = new Blob([ab], { type: "audio/webm" });
    form.append("file", blob, "chunk.webm");
    form.append("model", "whisper-1"); // Stable as of now
    if (inputLang && inputLang !== "AUTO") {
      // If you choose a specific language (e.g. "en"), give Whisper the hint
      // Whisper expects ISO 639-1 like "en", "es" (not a locale like en-US)
      form.append("language", inputLang.split("-")[0]);
    }

    const tRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });

    if (!tRes.ok) {
      const errText = await safeText(tRes);
      return NextResponse.json(
        { ok: false, error: `Whisper failed: ${tRes.status} ${errText}` },
        { status: 502 }
      );
    }
    const tJson = await tRes.json();
    const english = (tJson.text || "").trim();

    // If nothing meaningful was heard, stop here quietly.
    if (!english) {
      return NextResponse.json({ ok: true, skipped: "empty transcription" });
    }

    // ----- Translate with GPT (single JSON response for all target languages) -----
    // You can swap to a different model if you prefer.
    const model = "gpt-4o-mini";

    const prompt = [
      {
        role: "system",
        content:
          "You are a fast, accurate live-translation helper. Translate the given English text into each requested target language. Strictly return a single JSON object whose keys are the language codes and whose values are the translations. Do not include anything else.",
      },
      {
        role: "user",
        content: JSON.stringify({
          text: english,
          target_langs: targetLangs, // e.g. ["es","vi","zh"]
        }),
      },
    ];

    const jRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        temperature: 0.2,
        messages: prompt,
      }),
    });

    if (!jRes.ok) {
      const errText = await safeText(jRes);
      return NextResponse.json(
        { ok: false, error: `Translate failed: ${jRes.status} ${errText}` },
        { status: 502 }
      );
    }

    const j = await jRes.json();
    const content = j.choices?.[0]?.message?.content || "{}";

    let translations = {};
    try {
      translations = JSON.parse(content);
    } catch {
      // If parsing fails, just fall back to empty translations
      translations = {};
    }

    // ----- Push a line to the session -----
    const line = {
      ts: Date.now(),
      en: english,
      tx: translations, // { es: "...", vi: "...", zh: "..." }
    };

    addLine(code, line);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("ingest error", err);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}

// tiny helper to avoid throwing when reading error bodies
async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
