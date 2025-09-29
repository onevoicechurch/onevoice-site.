// /app/api/ingest/route.js
// Receives mic chunks, transcribes with OpenAI, translates, and broadcasts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { addLine, getSession } from "../_lib/sessionStore";

const MIN_BYTES = 1000; // ignore very tiny chunks
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export async function POST(req) {
  try {
    // --- query params ---
    const url = new URL(req.url);
    const code = url.searchParams.get("code") || "";
    const inputLang = url.searchParams.get("inputLang") || "AUTO";
    const langsCsv = url.searchParams.get("langs") || "es";
    const targetLangs = langsCsv.split(",").map(s => s.trim()).filter(Boolean);

    // --- validate ---
    const session = getSession(code);
    if (!code || !session) {
      return NextResponse.json({ ok: false, error: "No such session" }, { status: 404 });
    }
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    // --- read raw audio bytes ---
    const ab = await req.arrayBuffer();
    const bytes = ab.byteLength || 0;
    if (bytes < MIN_BYTES) {
      return NextResponse.json({ ok: true, skipped: "tiny_chunk" });
    }

    // figure out a reasonable file extension
    const contentType = req.headers.get("content-type") || "audio/webm";
    const ext =
      contentType.includes("wav") ? "wav" :
      contentType.includes("mp3") ? "mp3" :
      contentType.includes("ogg") ? "ogg" :
      contentType.includes("m4a") ? "m4a" : "webm";

    // --- TRANSCRIBE (OpenAI) ---
    // prefer the current small STT model
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
      // show a short diagnostic in Operator Live Preview
      addLine(code, {
        ts: Date.now(),
        en: `[transcribe error ${txResp.status}] ${errText.slice(0, 120)}`,
        tx: Object.fromEntries(targetLangs.map(l => [l, ""])),
      });
      return NextResponse.json(
        { ok: false, error: "transcription_failed", detail: errText },
        { status: 502 }
      );
    }

    const txJson = await txResp.json();
    const englishText = (txJson?.text || "").trim();
    if (!englishText) {
      return NextResponse.json({ ok: true, empty: true });
    }

    // --- TRANSLATE (parallel) ---
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

    // --- BROADCAST ---
    addLine(code, { ts: Date.now(), en: englishText, tx: translations });

    return NextResponse.json({ ok: true });
  } catch (err) {
    // bubble a short error into the preview to help debug
    try {
      const url = new URL(req.url);
      const code = url.searchParams.get("code") || "";
      if (code) {
        addLine(code, {
          ts: Date.now(),
          en: `[server error] ${String(err?.message || err).slice(0, 120)}`,
          tx: {},
        });
      }
    } catch {}
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
