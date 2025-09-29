// /app/api/ingest/route.js
// Ingest mic chunks, transcribe (4o-mini-transcribe with fallback to whisper-1),
// translate to requested languages, and broadcast via the in-memory session store.

export const runtime = "nodejs";           // required on Vercel for Blob/FormData
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

// ✅ correct relative import (no alias):
import { addLine, getSession } from "../_lib/sessionStore";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Ignore tiny blobs (bad recorder ticks, saves $)
const MIN_BYTES = 1500;

function langHint(inputLang) {
  if (!inputLang || inputLang.toUpperCase() === "AUTO") return undefined;
  return (inputLang + "").split("-")[0]; // "en-US" -> "en"
}

function extFromType(ct = "") {
  const t = ct.toLowerCase();
  if (t.includes("wav")) return "wav";
  if (t.includes("mp3")) return "mp3";
  if (t.includes("ogg")) return "ogg";
  if (t.includes("oga")) return "oga";
  if (t.includes("m4a")) return "m4a";
  if (t.includes("mp4")) return "mp4";
  if (t.includes("mpeg") || t.includes("mpga")) return "mp3";
  return "webm"; // most browsers: audio/webm;codecs=opus
}

async function transcribeWith(model, ab, contentType, language) {
  const form = new FormData();
  form.append("file", new Blob([ab], { type: contentType }), `clip.${extFromType(contentType)}`);
  form.append("model", model);
  if (language) form.append("language", language);

  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  return r;
}

async function translateOne(target, englishText) {
  const body = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: `Translate into ${target}. Output only the translation.` },
      { role: "user", content: englishText },
    ],
    temperature: 0.2,
  };
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) return "";
  const j = await r.json().catch(() => null);
  return (j?.choices?.[0]?.message?.content || "").trim();
}

export async function POST(req) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code") || "";
    const inputLang = url.searchParams.get("inputLang") || "AUTO";
    const langsCsv = url.searchParams.get("langs") || "es";
    const targets = langsCsv.split(",").map(s => s.trim()).filter(Boolean);

    if (!OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }
    if (!code) {
      return NextResponse.json({ ok: false, error: "Missing session code" }, { status: 400 });
    }
    const session = getSession(code);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Session not found" }, { status: 404 });
    }

    // raw audio
    const ab = await req.arrayBuffer();
    const bytes = ab.byteLength || 0;
    if (bytes < MIN_BYTES) {
      // tiny or silent – ignore without error
      return NextResponse.json({ ok: true, skipped: "tiny_chunk" });
    }

    const contentType = req.headers.get("content-type") || "audio/webm";
    const language = langHint(inputLang);

    // Try 4o-mini-transcribe first
    let txText = "";
    let firstErr = null;

    let r = await transcribeWith("gpt-4o-mini-transcribe", ab, contentType, language);
    if (!r.ok) {
      firstErr = await r.text().catch(() => "");
      // Fallback to whisper-1 (often more permissive about webm/opus)
      r = await transcribeWith("whisper-1", ab, contentType, language);
    }
    if (!r.ok) {
      const fallbackErr = await r.text().catch(() => "");
      // Show a diagnostic line so the operator sees what happened
      addLine(code, {
        ts: Date.now(),
        en: `[transcribe error ${r.status}]`,
        tx: Object.fromEntries(targets.map(t => [t, ""])),
      });
      return NextResponse.json(
        { ok: false, error: "transcription_failed", firstErr, fallbackErr },
        { status: 502 }
      );
    }
    const j = await r.json().catch(() => ({}));
    txText = (j?.text || "").trim();

    if (!txText) {
      // Nothing recognized; do not fan out translations
      return NextResponse.json({ ok: true, empty: true });
    }

    // Translate in parallel
    const translations = Object.fromEntries(
      await Promise.all(
        targets.map(async (t) => [t, await translateOne(t, txText)])
      )
    );

    // Broadcast
    addLine(code, { ts: Date.now(), en: txText, tx: translations });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("ingest fatal error", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
