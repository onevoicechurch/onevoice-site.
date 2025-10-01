export const runtime = 'nodejs';

import { appendLog } from '../_lib/kv.js';

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const code = (body?.code || '').toUpperCase();
  const text = (body?.text || '').trim();
  if (!code) return Response.json({ ok: false, error: 'missing code' }, { status: 400 });
  if (text) await appendLog(code, text);
  return Response.json({ ok: true });
}
