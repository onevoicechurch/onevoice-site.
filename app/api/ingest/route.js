import { NextResponse } from "next/server";
import OpenAI from "openai";

import {
  addLine,
  getSession,
} from "@/app/api/_lib/sessionStore"; // ✅ fixed import

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// handle POST from Operator mic
export async function POST(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const inputLang = searchParams.get("inputLang") || "auto";
  const langs = (searchParams.get("langs") || "es").split(",");

  if (!code) {
    return NextResponse.json({ error: "Missing session code" }, { status: 400 });
  }

  const session = getSession(code);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    // Grab audio blob
    const body = await req.arrayBuffer();
    const audioFile = new Blob([body], { type: "audio/webm" });

    // Use OpenAI’s new transcription model
    const transcription = await client.audio.transcriptions.create({
      file: audioFile,
      model: "gpt-4o-mini-transcribe",
      language: inputLang === "AUTO" ? undefined : inputLang,
    });

    const text = transcription.text;

    // Translate into target languages
    const translations = {};
    for (const lang of langs) {
      if (!lang) continue;
      const tx = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Translate into ${lang}, no explanations.`,
          },
          { role: "user", content: text },
        ],
      });
      translations[lang] = tx.choices[0].message.content;
    }

    // Push to session
    const line = {
      ts: Date.now(),
      en: text,
      tx: translations,
    };
    addLine(code, line);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Ingest error:", err);
    return NextResponse.json(
      { error: "Transcription failed", details: err.message },
      { status: 500 }
    );
  }
}
