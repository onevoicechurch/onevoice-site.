// app/api/ingest/route.js
import { NextResponse } from "next/server";
import { kv, appendLog } from "../_lib/kv.js";

export const runtime = "nodejs";

function pickContentType(t) {
  if (!t) return "audio/webm";
  t = String(t).toLowerCase();
  if (t.includes("webm")) return "audio/webm";
  if (t.includes("ogg")) return "audio/ogg";
  if (t.includes("mp3") || t.includes("mpeg")) return "audio/mpeg";
  if (t.includes("wav")) return "audio/wav";
  return t; // last resort: pass through
}

function deepgramURL(lang) {
  const base = "https://api.deepgram.com/v1/listen";
  const q = new URLSearchParams({
    model: "nova-2",
    smart_format: "true",
  });
  if (lang) q.set("language", lang);
  else q.set("detect_language", "true");
  return `${base}?${q.toString()}`;
}

export async function POST(req) {
  // If the operator sends a “flush ping” with JSON, just acknowledge
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    const code = String(body.code || "").toUpperCase();
    if (!code) return NextResponse.json({ ok: false, error: "MISSING_CODE" }, { status: 400 });
    return NextResponse.json({ ok: true, flushed: true });
  }

  // Expect multipart/form-data with: audio (Blob), code, lang (optional)
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: "FORMDATA_PARSE_ERROR" }, { status: 400 });

  const file = form.get("audio");
  const code = String(form.get("code") || "").toUpperCase();
  const lang = String(form.get("lang") || "");

  if (!code) return NextResponse.json({ ok: false, error: "MISSING_CODE" }, { status: 400 });
  if (!file || typeof file.arrayBuffer !== "function") {
    return NextResponse.json({ ok: false, error: "NO_AUDIO_FILE" }, { status: 400 });
  }
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: "DEEPGRAM_API_KEY_MISSING" }, { status: 500 });

  // Normalize the content-type for Deepgram
  const sendType = pickContentType(file.type);
  const ab = await file.arrayBuffer();
  if (!ab || ab.byteLength === 0) {
    return NextResponse.json({ ok: false, error: "EMPTY_AUDIO" }, { status: 400 });
  }

  // Send raw audio bytes to Deepgram /listen
  const url = deepgramURL(lang);
  const dgRes = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": sendType,
    },
    body: Buffer.from(ab),
  });

  if (!dgRes.ok) {
    const text = await dgRes.text().catch(() => "");
    return NextResponse.json(
      {
        ok: false,
        error: `Deepgram error ${dgRes.status}: ${text}`,
        debug: { sendType, size: ab.byteLength, lang },
      },
      { status: 400 }
    );
  }

  const data = await dgRes.json().catch(() => ({}));
  const transcript =
    data?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || "";

  if (transcript) {
    await appendLog(code, transcript);
    await kv.set(`onevoice:latest:${code}`, { text: transcript, lang, t: Date.now() });
  }

  return NextResponse.json({ ok: true, text: transcript });
}
