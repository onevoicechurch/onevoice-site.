// /app/api/ingest/route.js
import { NextResponse } from "next/server";
import { kv, appendLog } from "../_lib/kv";

export const runtime = "nodejs";

// Map browser-provided mime to what Deepgram expects in Content-Type
function normalizeMime(input) {
  const m = (input || "").toLowerCase();
  if (m.includes("audio/ogg")) return "audio/ogg";
  if (m.includes("audio/webm")) return "audio/webm";
  if (m.includes("audio/mpeg")) return "audio/mpeg"; // mp3
  if (m.includes("audio/wav") || m.includes("audio/x-wav")) return "audio/wav";
  // safe default (Chrome)
  return "audio/webm";
}

export async function POST(req) {
  try {
    // Accept either multipart (normal audio chunks) or JSON (flush ping)
    const ct = req.headers.get("content-type") || "";
    let code = "";
    let lang = "";
    let raw = null;            // Buffer of audio
    let clientMime = "";

    if (ct.startsWith("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("audio");
      code = (form.get("code") || "").toString().trim().toUpperCase();
      lang = (form.get("lang") || "").toString().trim();
      clientMime = (form.get("mime") || file?.type || "").toString();
      if (!file || !code) {
        return NextResponse.json({ ok: false, error: "MISSING_FILE_OR_CODE" }, { status: 400 });
      }
      const ab = await file.arrayBuffer();
      raw = Buffer.from(ab);
    } else {
      const body = await req.json().catch(() => ({}));
      code = (body.code || "").toString().trim().toUpperCase();
      lang = (body.lang || "").toString().trim();
      // JSON ping = just acknowledge so SSE can flush quickly
      if (!code) {
        return NextResponse.json({ ok: false, error: "MISSING_CODE" }, { status: 400 });
      }
      return NextResponse.json({ ok: true, ping: true });
    }

    // If we actually got audio, forward to Deepgram
    const mime = normalizeMime(clientMime);
    const params = new URLSearchParams({
      model: "nova-2-general",
      smart_format: "true",
    });
    // If the operator chose a language, tell Deepgram; otherwise let it auto-detect
    if (lang && lang !== "AUTO") params.set("language", lang);
    // For ogg/webm containers, tell Deepgram it's Opus
    if (mime === "audio/ogg" || mime === "audio/webm") params.set("encoding", "opus");

    const dgKey = process.env.DEEPGRAM_API_KEY || "";
    if (!dgKey) {
      return NextResponse.json({ ok: false, error: "DEEPOGRAM_KEY_MISSING" }, { status: 500 });
    }

    const dgRes = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${dgKey}`,
        "Content-Type": mime,
      },
      body: raw,
    });

    if (!dgRes.ok) {
      const text = await dgRes.text().catch(() => "");
      return NextResponse.json(
        {
          ok: false,
          error: `Deepgram error ${dgRes.status}: ${text}`,
          debug: { sendType: mime, size: raw?.length ?? 0, lang: lang || "auto" },
        },
        { status: 400 }
      );
    }

    const data = await dgRes.json().catch(() => ({}));
    // Pull the best transcript Deepgram gives us
    const alt = data?.results?.channels?.[0]?.alternatives?.[0];
    const transcript = alt?.paragraphs?.transcript || alt?.transcript || "";

    if (transcript) {
      await appendLog(code, transcript);
      await kv.set(`onevoice:latest:${code}`, { text: transcript, lang: lang || "", t: Date.now() });
    }

    return NextResponse.json({ ok: true, text: transcript || "" });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
