import { NextResponse } from "next/server";
import { newCode, createSession, endSession, getSession } from "../_lib/sessionStore";

export async function POST(req) {
  // optional: accept a code to reuse; otherwise generate
  const code = newCode();
  createSession(code);
  return NextResponse.json({ code });
}

export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code || !getSession(code)) {
    return NextResponse.json({ ok: false, error: "No such session" }, { status: 404 });
  }
  endSession(code);
  return NextResponse.json({ ok: true });
}
