// app/api/ingest/route.js (DIAGNOSTIC)
import { NextResponse } from "next/server";
import { addLine, getSession } from "../../_lib/sessionStore";

export async function POST(req) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code") || "";
    const inputLang = url.searchParams.get("inputLang") || "AUTO";
    const langs = (url.searchParams.get("langs") || "es").split(",");

    const session = getSession(code);
    if (!session) {
      return NextResponse.json({ ok: false, error: "No such session" }, { status: 404 });
    }

    // read the chunk so we can confirm bytes
    const ab = await req.arrayBuffer();
    const bytes = ab.byteLength || 0;

    // ✅ Write a simple line every time a chunk arrives
    const line = {
      ts: Date.now(),
      en: `[chunk received • ${bytes} bytes • input=${inputLang}]`,
      tx: Object.fromEntries(langs.map((l) => [l.trim(), `[chunk received]`]))
    };
    addLine(code, line);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("ingest diagnostic error", err);
    return NextResponse.json({ ok: false, error: "ingest error" }, { status: 500 });
  }
}
