import { appendLog } from "../_lib/kv";

export const runtime = "nodejs";

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const code = (body?.code ? String(body.code) : "").toUpperCase();
  const text = body?.text ? String(body.text) : "";

  if (!code || !text) {
    return new Response(JSON.stringify({ ok: false, error: "MISSING_FIELDS" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  await appendLog(code, text);
  return Response.json({ ok: true });
}
