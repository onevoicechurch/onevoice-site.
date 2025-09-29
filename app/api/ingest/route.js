// /app/api/ingest/route.js
// Ingest mic chunks from the Operator, transcribe with OpenAI,
// translate to requested target languages, and push lines
// to all listeners via the in-memory session store.

export const runtime = "nodejs";           // use Node runtime on Vercel
export const dynamic = "force-dynamic";    // never try to prerender this

import { NextResponse } from "next/server";
import { addLine, getSession } from "../_lib/sessionStore";

// Drop tiny/empty chunks (saves cost + noise)
const MIN_BYTES = 1200;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // set in Vercel → Project → Settings → Environment Variables

export async function POST(req) {
  try {
    // ---- query params ----
    const url = new URL(req.url);
    const code = url.searchParams.get("code") || "";
    const inputLang = url.searchParams.get("inputLang") || "AUTO"; // e.g. "en-US" or "AUTO"
    const langsCsv = url.searchParams.get("langs") || "es";
    const targetLangs = langsCsv.split(",").map(s => s.trim()).filter(Boolean); // ["es","vi","zh"]

    // ---- validate session ----
    const session = getSession(code);
    if (!code || !session) {
      return NextResponse.json({ ok: false, error: "No such session" }, { status: 404 });
    }

    if (!OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    // ---- read raw audio ----
    const ab = await req.arrayBuffer();
    const bytes = ab.byteLength || 0;
    if (bytes < MIN_BYTES) {
      return NextResponse.json({ ok: true, skipped: "tiny_chunk" });
    }

    const contentType = req.headers.get("content-type") || "audio/webm";
    const ext =
      contentType.includes("wav") ? "wav" :
      contentType.includes("mp3") ? "mp3" :
      contentType.includes("ogg") ? "ogg" :
      contentType.includes("m4a") ? "m4a" :
      "webm";

    // ---- Whisper replacement: gpt-4o-mini-transcribe ----
    const form = new FormData();
    form.append("file", new Blob([ab], { type: contentType }), `clip.${ext}`);
    form.append("model", "gpt-4o-mini-transcribe");

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
      addLine(code, {
        ts: Date.now(),
        en: `[transcribe error ${txResp.status}]`,
        tx: Object.fromEntries(targetLangs.map(l => [l, ""])),
      });
      return NextResponse.json({ ok: false, error: "transcription_failed", detail: errText }, { status: 502 });
    }

    const txJson = await txResp.json();
    const englishText = (txJson?.text || "").trim();

    if (!englishText) {
      // Nothing useful—don't fan out translators
      return NextResponse.json({ ok: true, empty: true });
    }

    // ---- translate in parallel (small model) ----
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
      if (!r.ok) return "";
      const j = await r.json();
      return (j?.choices?.[0]?.message?.content || "").trim();
    }

    const translations = Object.fromEntries(
      await Promise.all(targetLangs.map(async l => [l, await translateOne(l)]))
    );

    // ---- broadcast ----
    addLine(code, {
      ts: Date.now(),
      en: englishText,
      tx: translations,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("ingest fatal error", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
