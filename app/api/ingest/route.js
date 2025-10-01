// app/api/ingest/route.js
import { NextResponse } from "next/server";
import { kv, appendLog } from "../_lib/kv";

export const runtime = "nodejs";

export async function POST(req) {
  const ct = req.headers.get("content-type") || "";
  let code = "";
  let lang = "";
  let text = "";

  // ---- path A: multipart form with audio (recommended) ----
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    code = String(form.get("code") || "").toUpperCase();
    lang = String(form.get("lang") || ""); // e.g. "en", "es"; empty = auto
    const file = form.get("audio");

    if (!code || !file || typeof file !== "object") {
      return NextResponse.json(
        { ok: false, error: "MISSING_AUDIO_OR_CODE" },
        { status: 400 }
      );
    }

    // Send the chunk to Deepgram (prerecorded endpoint) for quick transcription
    const buf = Buffer.from(await file.arrayBuffer());
    const dgUrl = new URL("https://api.deepgram.com/v1/listen");
    dgUrl.searchParams.set("model", "nova-2-general");
    dgUrl.searchParams.set("smart_format", "true");
    dgUrl.searchParams.set("punctuate", "true");
    if (lang && lang !== "auto") {
      dgUrl.searchParams.set("language", lang);
    } else {
      dgUrl.searchParams.set("detect_language", "true");
    }

    const dgRes = await fetch(dgUrl.toString(), {
      method: "POST",
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        "Content-Type": file.type || "audio/webm",
      },
      body: buf,
      // Keep this on the Node runtime (we set export const runtime = "nodejs")
    });

    if (!dgRes.ok) {
      const detail = await dgRes.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: `DEEPGRAM_${dgRes.status}`, detail: detail.slice(0, 500) },
        { status: 502 }
      );
    }

    const dg = await dgRes.json();
    text =
      dg?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || "";

  } else {
    // ---- path B: JSON fallback (supports your older UI that posted {code,text}) ----
    const body = await req.json().catch(() => ({}));
    code = String(body.code || "").toUpperCase();
    lang = String(body.lang || "");
    text = String(body.text || "");
  }

  // If nothing transcribed, just ack ok:true so the UI keeps flowing
  if (!code) {
    return NextResponse.json(
      { ok: false, error: "MISSING_CODE" },
      { status: 400 }
    );
  }
  if (!text) {
    return NextResponse.json({ ok: true, empty: true });
  }

  // Persist for listeners
  await appendLog(code, text);
  await kv.set(`onevoice:latest:${code}`, { text, lang, t: Date.now() });

  return NextResponse.json({ ok: true, text });
}
