// KV-backed session store — avoids serverless memory issues.
import { kv } from '@vercel/kv';

const SKEY = (code) => `onevoice:${code}`;
const LKEY = (code) => `onevoice:${code}:lines`;

/** create a session or reset it */
export async function createSession(code) {
  const now = Date.now();
  await kv.mset({
    [SKEY(code)]: JSON.stringify({ code, createdAt: now, lastSeq: 0, nextLineId: 1, closed: false }),
  });
  // reset lines list
  await kv.del(LKEY(code));
}

/** mark session closed and clean later (keep lines for a bit) */
export async function endSession(code) {
  const raw = await kv.get(SKEY(code));
  if (!raw) return;
  const state = JSON.parse(raw);
  state.closed = true;
  await kv.set(SKEY(code), JSON.stringify(state));
}

/** append a new caption line if this seq is newer than lastSeq */
export async function appendLineIfNewer(code, seq, text, lang) {
  const skey = SKEY(code);
  const lkey = LKEY(code);

  // Use a transaction to prevent duplicates/out-of-order
  // (best-effort with WATCH behavior via eval script pattern not available => we sequence with lastSeq)
  const raw = await kv.get(skey);
  if (!raw) return { accepted: false, reason: 'no-session' };
  const state = JSON.parse(raw);
  if (seq <= state.lastSeq) return { accepted: false, reason: 'duplicate-or-old' };

  const id = state.nextLineId || 1;
  const line = { id, ts: Date.now(), text, lang: lang || null };

  await Promise.all([
    kv.rpush(lkey, JSON.stringify(line)),
    kv.set(skey, JSON.stringify({ ...state, lastSeq: seq, nextLineId: id + 1 })),
  ]);
  return { accepted: true, line };
}

/** get new lines after a client-known id (exclusive) */
export async function getLinesSince(code, sinceId = 0, limit = 100) {
  const lkey = LKEY(code);
  const list = await kv.lrange(lkey, 0, -1);
  if (!list || !list.length) return [];
  const parsed = list.map((s) => JSON.parse(s));
  return parsed.filter((x) => x.id > sinceId).slice(0, limit);
}

/** quick health state for header */
export async function getState(code) {
  const raw = await kv.get(SKEY(code));
  return raw ? JSON.parse(raw) : null;
}
