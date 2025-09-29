export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { addLine, getSession } from "../_lib/sessionStore";

// Drop tiny payloads completely — they tend to trigger 400s.
const MIN_BYTES = 6000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function pickExtFromContentType(ct) {
  if (!ct) return "webm";
  if (ct.includes("wav")) return "wav";
  if (ct.includes("mp3")) return "mp3";
  if (ct.includes("ogg")) return "ogg";
  if (ct.includes("m4a")) return "m4a";
  if (ct.includes("mp4")) return "mp4";
  if (ct.includes("mpeg") || ct.includes("mpga")) return "mp3";
  return "webm";
}

// Try whisper-1 first (more forgiving). If it 400s for format, try 4o-mini-transcribe.
async function transcribeWithFallback(ab, contentType, inputLang) {
  const ext = pickExtFromContentType(contentType);
  // Normalize to a proper File; avoid passing through the browser's codecs string.
  const file = new File([ab], `clip.${ext}`, { type: "audio/webm" });

  // Helper to call OpenAI transcription endpoint
  async function callTranscribe(model) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("model", model);
    if (inputLang && inputLang !== "AUTO") {
      // openai expects primary code like "en", "es"
      fd.append("language", inputLang.split("-")[0]);
    }
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: fd,
    });
    return r;
  }

  // 1) whisper-1
  {
    const r = await callTranscribe("whisper-1");
    if (r.ok) {
      const j = await r.json();
      return (j?.text || "").trim();
    }
    // Only fall back on obvious format/corruption 400s; otherwise throw.
    if (r.status !== 400) {
      const t = await r.text().catch(() => "");
      throw new Error(`whisper-1 failed (${r.status}): ${t}`);
    }
  }

  // 2) gpt-4o-mini-transcribe (fallback)
  {
    const r = await callTranscribe("gpt-4o-mini-transcribe");
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`4o-mini-transcribe failed (${r.status}): ${t}`);
    }
    const j = await r.json();
    return (j?.text || "").trim();
  }
}

async function translateAll(englishText, targets) {
  if (!targets.length) return {};
  const results = await Promise.all(
    targets.map(async (lang) => {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0, // keep translations steady
          messages: [
            { role: "system", content: `Translate into ${lang}. Return only the translation.` },
            { role: "user", content: englishText },
          ],
        }),
      });
      if (!r.ok) return [lang, ""];
      const j = await r.json();
      return [lang, (j?.choices?.[0]?.message?.content || "").trim()];
    })
  );
  return Object.fromEntries(results);
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
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const ab = await req.arrayBuffer();
    const bytes = ab.byteLength || 0;
    if (bytes < MIN_BYTES) {
      // Too tiny — skip to avoid the noisy 400 loop.
      return NextResponse.json({ ok: true, skipped: "tiny" });
    }

    const contentType = req.headers.get("content-type") || "audio/webm";

    let englishText = "";
    try {
      englishText = await transcribeWithFallback(ab, contentType, inputLang);
    } catch (e) {
      addLine(code, {
        ts: Date.now(),
        en: `[transcribe error] ${(e?.message || "").slice(0, 180)}`,
        tx: Object.fromEntries(targetLangs.map((l) => [l, ""])),
      });
      return NextResponse.json({ ok: false, error: "transcription_failed" }, { status: 502 });
    }

    if (!englishText) {
      return NextResponse.json({ ok: true, empty: true });
    }

    const translations = await translateAll(englishText, targetLangs);
    addLine(code, { ts: Date.now(), en: englishText, tx: translations });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("ingest fatal", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
