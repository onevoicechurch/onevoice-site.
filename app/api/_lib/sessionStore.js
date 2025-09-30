// Simple in-memory store for live sessions (Vercel serverless: ephemeral per instance)
const sessions = new Map();
// sessions.set(code, { code, createdAt, closed: false, cursor: 0, lines: [] })

export function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function createSession(code) {
  const key = (code || newCode()).toUpperCase();
  sessions.set(key, { code: key, createdAt: Date.now(), closed: false, cursor: 0, lines: [] });
  return key;
}

export function endSession(code) {
  const s = sessions.get(code);
  if (s) s.closed = true;
  return !!s;
}

export function addLine(code, text) {
  const s = sessions.get(code);
  if (!s || s.closed) return false;
  const item = { ts: Date.now(), text: String(text || '').trim() };
  if (!item.text) return false;
  s.lines.push(item);
  s.cursor = s.lines.length;
  return true;
}

export function getSince(code, since = 0) {
  const s = sessions.get(code);
  if (!s) return { items: [], next: since };
  const start = Number.isFinite(+since) ? +since : 0;
  const items = s.lines.slice(start);
  const next = start + items.length;
  return { items, next };
}

export function isReady(code) {
  return sessions.has(code) && !sessions.get(code).closed;
}
