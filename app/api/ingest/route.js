import { NextResponse } from "next/server";
import { addLine, getSession } from "../_lib/sessionStore";

export async function POST(req) {
  const searchParams = new URL(req.url).searchParams;
  const code = searchParams.get("code");
  const inputLang = searchParams.get("inputLang") || "AUTO";
  const langs = (searchParams.get("langs") || "es").split(",");

  const session = getSession(code);
  if (!session) {
    return NextResponse.json({ ok: false, error: "No such session" }, { status: 404 });
  }

  // For now, fake transcription/translation
  const fakeText = "[demo] audio received";

  const line = {
    ts: Date.now(),
    en: fakeText,
    tx: Object.fromEntries(langs.map((l) => [l, fakeText + " (" + l + ")"])),
  };

  addLine(code, line);

  return NextResponse.json({ ok: true });
}
