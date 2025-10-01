import { NextResponse } from "next/server";
import { kv } from "../_lib/kv";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const code = String(body?.code || "").toUpperCase();
  const text = String(body?.text || "");
  if (!code || !text) return NextResponse.json({ ok: false }, { status: 400 });
  await kv.rpush(`onevoice:log:${code}`, text);
  return NextResponse.json({ ok: true });
}
