import { kv } from "../_lib/kv";

export const runtime = "nodejs";

function newCode() {
  // 4-letter/number code, uppercase
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const provided = body?.code ? String(body.code) : "";
  const code = (provided || newCode()).toUpperCase().slice(0, 4);

  // Keep a small session record (4 hours expiry)
  await kv.set(`onevoice:session:${code}`, { createdAt: Date.now() }, { ex: 60 * 60 * 4 });

  return Response.json({ ok: true, code });
}

export async function DELETE(req) {
  const u = new URL(req.url);
  const code = (u.searchParams.get("code") || "").toUpperCase();
  if (!code) return new Response("Missing code", { status: 400 });

  await kv.del(`onevoice:session:${code}`);
  return Response.json({ ok: true });
}
