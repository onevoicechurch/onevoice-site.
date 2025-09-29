// /app/api/ingest/route.js
// Receives mic chunks, transcribes with OpenAI, translates, and pushes lines
// into the in-memory session via sessionStore.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { addLine, getSession } from "../_lib/sessionStore";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Keep this tiny while testing so we don't drop short chunks
const MIN_BYTES = 1;

// Helpers
function extFor(type) {
  if (!type) return "webm";
  if (type.includes("wav")) return "wav";
  if (type.includes("mp3")) return "mp3";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("m4a")) return "m4a";
  return "webm";
}

async function transcribeWith(model, ab, contentType, langHint, apiKey) {
  const form = new FormData();
  form.append("file", new Blob([ab], { type: contentType }), `clip.${extFor(contentType)}`);
  form.append("model", model);
  if (langHint && langHint !== "AUTO") {
    form.append("language", langHint.split("-")[0]); // "en-US" -> "en"
  }
  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  return resp;
}

async function translateText(englishText, targets, apiKey) {
  if (!targets.length) return {};
  const entries = await Promise.all(
    targets.map(async (target) => {
      const prompt = `Translate into ${target}. Return only the translation:\n\n${englishText}`;
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
        }),
      });
      if (!r.ok) return [target, ""];
      const j = await r.json();
      return [target, (j?.choices?.[0]?.message?.content || "").trim()];
    })
  );
  return Object.fromEntries(entries);
}

export async function POST(req) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code") || "";
    const inputLang = url.searchParams.get("inputLang") || "AUTO";
    const langsCsv = url.searchParams.get("langs") || "es";
    const targetLangs = langsCsv.split(",").map((s) => s.trim()).filter(Boolean);

    const session = getSession(code);
    if (!code || !session) {
      return NextResponse.json({ ok: false, error: "No such session" }, { status: 404 });
    }

    if (!OPENAI_API_KEY) {
      addLine(code, { ts: Date.now(), en: "[server error: missing OPENAI_API_KEY]", tx: {} });
      return NextResponse.json({ ok: false, error: "missing_api_key" }, { status: 500 });
    }

    const ab = await req.arrayBuffer();
    const bytes = ab.byteLength || 0;
    const contentType = req.headers.get("content-type") || "audio/webm";

    // Always show a tiny debug line so you can see traffic
    addLine(code, {
      ts: Date.now(),
      en: `🎤 chunk ${bytes}B (${contentType})`,
      tx: Object.fromEntries(targetLangs.map((l) => [l, ""])),
    });

    if (bytes < MIN_BYTES) {
      return NextResponse.json({ ok: true, skipped: "tiny_chunk" });
    }

    // Try modern model first, then fallback to whisper-1 on 400/404
    let txResp = await transcribeWith("gpt-4o-mini-transcribe", ab, contentType, inputLang, OPENAI_API_KEY);

    if (!txResp.ok && (txResp.status === 400 || txResp.status === 404)) {
      // Log the first failure so you can see it
      addLine(code, {
        ts: Date.now(),
        en: `[transcribe error ${txResp.status}] → retrying with whisper-1`,
        tx: Object.fromEntries(targetLangs.map((l) => [l, ""])),
      });
      txResp = await transcribeWith("whisper-1", ab, contentType, inputLang, OPENAI_API_KEY);
    }

    if (!txResp.ok) {
      const detail = await txResp.text().catch(() => "");
      addLine(code, {
        ts: Date.now(),
        en: `[transcribe error ${txResp.status}]`,
        tx: Object.fromEntries(targetLangs.map((l) => [l, ""])),
      });
      return NextResponse.json({ ok: false, error: "transcription_failed", detail }, { status: 502 });
    }

    const txJson = await txResp.json();
    const englishText = (txJson?.text || "").trim();

    if (!englishText) {
      addLine(code, { ts: Date.now(), en: "…(no speech detected)", tx: {} });
      return NextResponse.json({ ok: true, empty: true });
    }

    const translations = await translateText(englishText, targetLangs, OPENAI_API_KEY);

    addLine(code, { ts: Date.now(), en: englishText, tx: translations });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("ingest fatal error", err);
    // Surface something in the operator UI so you can see it immediately
    try {
      const url = new URL(req.url);
      const code = url.searchParams.get("code") || "";
      if (code) addLine(code, { ts: Date.now(), en: "[server crash in ingest]", tx: {} });
    } catch {}
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
