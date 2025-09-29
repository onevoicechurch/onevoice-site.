// app/api/ingest/route.js
export const runtime = 'nodejs';          // needed to use FormData/Buffer on Vercel
export const dynamic = 'force-dynamic';   // this route is always dynamic

import { NextResponse } from "next/server";
import { addLine, getSession } from "../../_lib/sessionStore";

export async function POST(req) {
  try {
    // ---- read query params ----
    const searchParams = new URL(req.url).searchParams;
    const code = searchParams.get("code");
    const inputLang = searchParams.get("inputLang") || "AUTO";
    const langs = (searchParams.get("langs") || "es").split(",").map(s => s.trim()).filter(Boolean);

    // ---- validate session ----
    const session = getSession(code);
    if (!code || !session) {
      return NextResponse.json({ ok: false, error: "No such session" }, { status: 404 });
    }

    // ---- read binary audio from request ----
    const contentType = req.headers.get("content-type") || "audio/webm";
    const ab = await req.arrayBuffer();
    const buf = Buffer.from(ab);
    const file = new Blob([buf], { type: contentType });

    // ---- send to OpenAI Whisper for transcription ----
    // Make sure OPENAI_API_KEY is set in Vercel → Project → Settings → Environment Variables
    const form = new FormData();
    form.append("file", file, "chunk.webm");
    form.append("model", "whisper-1");
    // Let Whisper auto-detect unless a specific input language was chosen
    if (inputLang && inputLang !== "AUTO") {
      // whisper expects short language codes like "en", "es", "vi"
      form.append("language", inputLang.split("-")[0]);
    }

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });

    if (!r.ok) {
      const errTxt = await r.text().catch(() => "");
      console.error("Whisper error:", r.status, errTxt);
      return NextResponse.json({ ok: false, error: "Transcription failed" }, { status: 502 });
    }

    const data = await r.json();
    const text = (data && data.text) ? data.text.trim() : "";
    if (!text) {
      // no speech in this chunk; just acknowledge
      return NextResponse.json({ ok: true, empty: true });
    }

    // ---- simple “translations”: reuse the same text per language for now ----
    // (We can swap this for real translations after transcription is working.)
    const tx = Object.fromEntries(langs.map(l => [l, text]));

    // ---- push line into the session (fans out to listeners) ----
    const line = {
      ts: Date.now(),
      en: text,  // store under 'en' for preview
      tx,        // { es: "...", vi: "...", ... }
    };
    addLine(code, line);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("ingest route error", err);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
