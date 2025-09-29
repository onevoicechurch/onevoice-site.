// /app/api/ingest/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { addLine, getSession } from "../_lib/sessionStore";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MIN_BYTES = 1; // keep tiny while testing

function extFor(type) {
  if (!type) return "webm";
  if (type.includes("wav")) return "wav";
  if (type.includes("mp3")) return "mp3";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("m4a")) return "m4a";
  return "webm";
}

async function txWith(model, ab, contentType, langHint, apiKey) {
  const form = new FormData();
  form.append("file", new Blob([ab], { type: contentType }), `clip.${extFor(contentType)}`);
  form.append("model", model);
  // Only pass language when user chose a concrete input; skip for AUTO
  if (langHint && langHint !== "AUTO") {
    form.append("language", langHint.split("-")[0]); // "en-US" -> "en"
  }
  return fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
}

async function translate(englishText, targets, apiKey) {
  if (!targets.length) return {};
  const pairs = await Promise.all(
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
  return Object.fromEntries(pairs);
}

export async function POST(req) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code") || "";
    const inputLang = url.searchParams.get("inputLang") || "AUTO";
    const targetLangs = (url.searchParams.get("langs") || "es")
      .split(",").map(s => s.trim()).filter(Boolean);

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

    // Always show chunk debug
    addLine(code, {
      ts: Date.now(),
      en: `🎤 chunk ${bytes}B (${contentType})`,
      tx: Object.fromEntries(targetLangs.map(l => [l, ""])),
    });

    if (bytes < MIN_BYTES) {
      return NextResponse.json({ ok: true, skipped: "tiny_chunk" });
    }

    // 1) Try whisper-1 first
    let resp = await txWith("whisper-1", ab, contentType, inputLang, OPENAI_API_KEY);

    // 2) If whisper-1 responds 400/404, try gpt-4o-mini-transcribe
    if (!resp.ok && (resp.status === 400 || resp.status === 404)) {
      const detail = (await resp.text().catch(() => ""))?.slice(0, 120);
      addLine(code, {
        ts: Date.now(),
        en: `[transcribe error ${resp.status}] whisper-1: ${detail || "(no detail)"} → try 4o-mini-transcribe`,
        tx: Object.fromEntries(targetLangs.map(l => [l, ""])),
      });
      resp = await txWith("gpt-4o-mini-transcribe", ab, contentType, inputLang, OPENAI_API_KEY);
    }

    if (!resp.ok) {
      const detail = (await resp.text().catch(() => ""))?.slice(0, 120);
      addLine(code, {
        ts: Date.now(),
        en: `[transcribe error ${resp.status}] ${detail || "(no detail)"}`,
        tx: Object.fromEntries(targetLangs.map(l => [l, ""])),
      });
      return NextResponse.json({ ok: false, error: "transcription_failed" }, { status: 502 });
    }

    const txJson = await resp.json();
    const englishText = (txJson?.text || "").trim();
    if (!englishText) {
      addLine(code, { ts: Date.now(), en: "…(no speech detected)", tx: {} });
      return NextResponse.json({ ok: true, empty: true });
    }

    const translations = await translate(englishText, targetLangs, OPENAI_API_KEY);
    addLine(code, { ts: Date.now(), en: englishText, tx: translations });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("ingest fatal error", err);
    try {
      const url = new URL(req.url);
      const code = url.searchParams.get("code") || "";
      if (code) addLine(code, { ts: Date.now(), en: "[server crash in ingest]", tx: {} });
    } catch {}
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
