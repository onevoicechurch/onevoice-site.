// /app/api/session/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { newCode, createSession, endSession, getSession } from "@/app/api/_lib/sessionStore";

// Create a new session code and start a session
export async function POST() {
  const code = newCode();
  createSession(code);
  return NextResponse.json({ code });
}

// End an existing session
export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code") || "";

  if (!code || !getSession(code)) {
    return NextResponse.json({ ok: false, error: "No such session" }, { status: 404 });
  }

  endSession(code);
  return NextResponse.json({ ok: true });
}
