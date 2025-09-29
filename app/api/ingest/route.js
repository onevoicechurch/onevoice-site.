// app/api/ingest/route.js
export const runtime = 'nodejs'; // use Node runtime (multipart/form-data friendly)

import { NextResponse } from "next/server";
import { addLine, getSession } from "../_lib/sessionStore";

// OPTIONAL: tweak these
const TRANSCRIBE_MODEL = "whisper-1";
const TRANSLATE_MODEL = "gpt-4o-mini"; // fast & cheap; returns JSON

export async function POST(req) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const inputLang = url.searchParams.get("inputLang") || "AUTO";
    const langs = (url.searchParams.get("langs") || "es").split(",").map(s => s.trim()).filter(Boolean);

    const session = getSession(code);
    if (!code || !session) {
      return NextResponse.json({ ok: false, error: "No such session" }, { status: 404 });
    }

    // Read raw audio body
    const contentType = req.headers.get("content-type") || "audio/webm";
    const ab = await req.arrayBuffer();

    // --- 1) Transcribe with Whisper ---
    const form = new FormData();
    const blob = new Blob([ab], { type: contentType });
    form.append("file", blob, "chunk.webm");
    form.append("model", TRANSCRIBE_MODEL);
    if (inputLang && inputLang !== "AUTO") {
      // Whisper expects BCP-47 or ISO 639-1. If you pass "en-US" it's fine; if missing, it auto-detects.
      form.append("language", inputLang);
    }

    const transcribeRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: form,
    });

    if (!transcribeRes.ok) {
      const errText = await transcribeRes.text().catch(() => "");
      console.error("Whisper error:", errText);
      return NextResponse.json({ ok: false, error: "Transcription failed" }, { status: 500 });
    }

    const transcription = await transcribeRes.json();
    const enText = (transcription.text || "").trim();
    if (!enText) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    // --- 2) Translate the English transcript into the requested languages in one call ---
    const translatePrompt = [
      {
        role: "system",
        content:
          "You translate English text into specific languages and return strict JSON only. " +
          "Keys must be the exact language codes provided. If a language is unknown, use an empty string."
      },
      {
        role: "user",
        content:
          `Translate the following English text into each of these language codes ${JSON.stringify(langs)}.\n` +
          `Return ONLY JSON like {"es":"...", "vi":"..."} with no extra text.\n\n` +
          `English: ${enText}`
      }
    ];

    const translateRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: TRANSLATE_MODEL,
        temperature: 0.2,
        messages: translatePrompt
      })
    });

    let tx = {};
    if (translateRes.ok) {
      const j = await translateRes.json();
      const raw = j.choices?.[0]?.message?.content || "{}";
      try {
        tx = JSON.parse(raw);
      } catch {
        // If parsing fails, just leave translations empty
        tx = Object.fromEntries(langs.map(l => [l, ""]));
      }
    } else {
      // Translation failed; still return English
      tx = Object.fromEntries(langs.map(l => [l, ""]));
    }

    // --- 3) Push a line to the session stream ---
    const line = {
      ts: Date.now(),
      en: enText,
      tx, // e.g. { es: "...", vi: "...", zh: "..." }
    };

    addLine(code, line);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("ingest route error", err);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
