// /app/api/ingest/route.js
// Ingest mic chunks from the Operator, transcribe with OpenAI,
// translate to the requested target languages, and push lines
// to all listeners via the in-memory session store.

export const runtime = "nodejs";           // <-- important on Vercel
export const dynamic = "force-dynamic";    // avoid any static assumptions

import { NextResponse } from "next/server";
import { addLine, getSession } from "../_lib/sessionStore";

// Helper: tiny guard so we don't waste $$ on silence/tiny bursts
const MIN_BYTES = 1200; // ~1s webm often > 1.5KB; tweak if needed

const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // set in Vercel → Project → Settings → Environment Variables

export async function POST(req) {
  try {
    // --- read query params ---
    const url = new URL(req.url);
    const code = url.searchParams.get("code") || "";
    const inputLang = url.searchParams.get("inputLang") || "AUTO"; // e.g. "en-US" or "AUTO"
    const langsCsv = url.searchParams.get("langs") || "es";
    const targetLangs = langsCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean); // e.g. ["es","vi","zh"]

    // --- validate session ---
    const session = getSession(code);
    if (!code || !session) {
      return NextResponse.json({ ok: false, error: "No such session" }, { status: 404 });
    }

    if (!OPENAI_API_KEY) {
      return NextResponse.json(
        { ok: false, error: "Missing OPENAI_API_KEY env var" },
        { status: 500 }
      );
    }

    // --- read the raw audio chunk ---
    const ab = await req.arrayBuffer();
    const bytes = ab.byteLength || 0;
    if (bytes < MIN_BYTES) {
      // Drop very tiny chunks (prevents spamming and saves cost)
      return NextResponse.json({ ok: true, skipped: "tiny_chunk" });
    }

    // Build a filename with a plausible extension for Whisper
    // Most browsers produce audio/webm; we’ll default to webm if missing.
    const contentType = req.headers.get("content-type") || "audio/webm";
    const ext =
      contentType.includes("wav") ? "wav" :
      contentType.includes("mp3") ? "mp3" :
      contentType.includes("ogg") ? "ogg" :
      contentType.includes("m4a") ? "m4a" :
      "webm";

    // --- Transcribe with Whisper (server-side multipart form) ---
    // Model options: "whisper-1" or "gpt-4o-transcribe" (if enabled on your account).
    const form = new FormData();
    form.append("file", new Blob([ab], { type: contentType }), `clip.${ext}`);
    form.append("model", "whisper-1");

    // If you want to hint the language (faster/cheaper than autodetect):
    // Whisper expects BCP-47-ish or ISO language names; we’ll pass only the primary code.
    if (inputLang && inputLang !== "AUTO") {
      const primary = inputLang.split("-")[0]; // "en-US" -> "en"
      form.append("language", primary);
    }

    const txResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });

    if (!txResp.ok) {
      const errText = await txResp.text().catch(() => "");
      // Still append a diagnostic line so the Operator sees something
      addLine(code, {
        ts: Date.now(),
        en: `[transcribe error ${txResp.status}]`,
        tx: Object.fromEntries(targetLangs.map((l) => [l, ""])),
      });
      return NextResponse.json(
        { ok: false, error: "transcription_failed", detail: errText },
        { status: 502 }
      );
    }

    const txJson = await txResp.json();
    const englishText = (txJson?.text || "").trim();

    // If Whisper returned nothing (silence/noise), don’t fan out translators
    if (!englishText) {
      return NextResponse.json({ ok: true, empty: true });
    }

    // --- Translate to requested target languages (parallel) ---
    // We’ll use a lightweight model for translation.
    // If your account has different naming, swap to a small chat model you have (e.g. "gpt-4o-mini").
    async function translateOne(target) {
      const prompt = `Translate the following text into ${target}. Return only the translation with no quotes:\n\n${englishText}`;
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
        }),
      });

      if (!r.ok) {
        return "";
      }

      const j = await r.json();
      return (j?.choices?.[0]?.message?.content || "").trim();
    }

    const translations = Object.fromEntries(
      await Promise.all(
        targetLangs.map(async (lang) => [lang, await translateOne(lang)])
      )
    );

    // --- Broadcast the line to listeners + show in Operator Live Preview ---
    const line = {
      ts: Date.now(),
      en: englishText,
      tx: translations, // e.g. { es: "...", vi: "...", zh: "..." }
    };
    addLine(code, line);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("ingest fatal error", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
