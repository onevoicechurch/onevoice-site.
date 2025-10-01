import { NextResponse } from "next/server";
import { createSession, endSession, newCode } from "../_lib/sessionStore";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const provided = body?.code ? String(body.code) : "";
  const code = (provided || newCode()).toUpperCase().slice(0, 8);
  await createSession(code);
  return NextResponse.json({ ok: true, code });
}

export async function DELETE(req: Request) {
  const code = new URL(req.url).searchParams.get("code")?.toUpperCase();
  if (!code) return NextResponse.json({ ok: false, error: "MISSING_CODE" }, { status: 400 });
  await endSession(code);
  return NextResponse.json({ ok: true });
}
