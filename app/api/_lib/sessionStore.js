// Simple in-memory store (one deployment/region). Good enough for demos.
const sessions = new Map(); // code -> { log: Array<{ts:number,text:string}>, cursor:number }

export function createSession(code) {
  if (!code) return;
  if (!sessions.has(code)) sessions.set(code, { log: [], cursor: 0 });
  return { ok: true };
}

export function endSession(code) {
  sessions.delete(code);
  return { ok: true };
}

export function appendLine(code, text) {
  const s = sessions.get(code);
  if (!s) return;
  s.log.push({ ts: Date.now(), text });
  s.cursor = s.log.length;
}

export function getSince(code, since = 0) {
  const s = sessions.get(code);
  if (!s) return { items: [], next: since };
  const start = Number.isFinite(since) ? since : 0;
  return { items: s.log.slice(start), next: s.log.length };
}
