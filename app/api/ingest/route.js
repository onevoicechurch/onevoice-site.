// /app/api/ingest/route.js
// Ingest mic chunks from the Operator, transcribe with OpenAI,
// translate to target languages, and broadcast to listeners.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { addLine, getSession } from "../../_lib/sessionStore"; // <- path from /app/api/ingest/

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// --- small guards / tuning ---
const MIN_BYTES = 1200; // drop tiny chunks to avoid spam & cost

// Helpers
function diag(code, text, targets = []) {
  addLine(code, {
    ts: Date.now(),
    en: text,
    tx: Object.fromEntries(targets.map((t) => [t, ""])),
  });
}

async function transcribeWith(model, ab, contentType, inputLang) {
  const fd = new FormData();
  // most browsers send audio/webm;codecs=opus; give the file a .webm name
  fd.append("file", new Blob([ab], { type: contentType }), "clip.webm");
  fd.append("model", model);
  if (inputLang && inputLang !== "AUTO") {
    // hint language (faster/cheaper than autodetect)
    fd.append("language", inputLang.split("-")[0]); // "en-US" -> "en"
  }

  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: fd,
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    const err = new Error(`transcribe ${model} failed ${r.status}`);
    err.status = r.status;
    err.detail = txt;
    throw err;
  }

  const j = await r.json();
  return (j?.text || "").trim();
}

async function translateOne(text, target) {
  const prompt = `Translate the following text into ${target}. Return only the translation, no quotes:\n\n${text}`;
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

  if (!r.ok) return "";
  const j = await r.json();
  return (j?.choices?.[0]?.message?.content || "").trim();
}

export async function POST(req) {
  try {
    // --- query params ---
    const url = new URL(req.url);
    const code = url.searchParams.get("code") || "";
    const inputLang = url.searchParams.get("inputLang") || "AUTO";
    const langsCsv = url.searchParams.get("langs") || "es";
    const targets = langsCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // --- session & env checks ---
    if (!code || !getSession(code)) {
      return NextResponse.json({ ok: false, error: "No such session" }, { status: 404 });
    }
    if (!OPENAI_API_KEY) {
      diag(code, "⚠️ Missing OPENAI_API_KEY env var");
      return NextResponse.json({ ok: false, error: "missing_api_key" }, { status: 500 });
    }

    // --- read audio chunk ---
    const ab = await req.arrayBuffer();
    const bytes = ab.byteLength || 0;
    const contentType = req.headers.get("content-type") || "audio/webm;codecs=opus";

    if (bytes < MIN_BYTES) {
      // too tiny; skip silently to reduce noise
      return NextResponse.json({ ok: true, skipped: "tiny_chunk" });
    }

    // Optional: small diagnostic line so you can see chunks arriving
    diag(code, `🗣️ 🎤 chunk ${bytes}B (${contentType})`, targets);

    // --- transcribe (try 4o, then whisper-1) ---
    let text = "";
    try {
      text = await transcribeWith("gpt-4o-transcribe", ab, contentType, inputLang);
    } catch (e) {
      // Show a short diagnostic
      diag(code, `🗣️ [transcribe error ${e.status || "?"}] 4o-transcribe → trying whisper-1`, targets);
      try {
        text = await transcribeWith("whisper-1", ab, contentType, inputLang);
      } catch (e2) {
        diag(code, `🗣️ [transcribe error ${e2.status || "?"}]`, targets);
        return NextResponse.json({ ok: false, error: "transcription_failed" }, { status: 502 });
      }
    }

    if (!text) {
      // empty or silence
      return NextResponse.json({ ok: true, empty: true });
    }

    // --- translate in parallel ---
    const translations = Object.fromEntries(
      await Promise.all(
        targets.map(async (t) => [t, await translateOne(text, t)])
      )
    );

    // --- broadcast line to listeners and preview ---
    addLine(code, {
      ts: Date.now(),
      en: text,
      tx: translations,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("ingest fatal error", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
