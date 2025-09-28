// Temporary in-memory store (demo). We'll swap to Vercel KV later.
const sessions = new Map();
// sessions.set(code, { active: true, lines: [], listeners: Set(res) })

export function createSession() {
  const code = Math.random().toString(36).slice(2, 6).toUpperCase(); // e.g., "X9KQ"
  sessions.set(code, { active: true, lines: [], listeners: new Set() });
  return code;
}

export function endSession(code) {
  const s = sessions.get(code);
  if (!s) return false;
  s.active = false;
  // Close any open SSE connections
  for (const res of s.listeners) {
    try { res.write(`event: end\ndata: {}\n\n`); res.flush?.(); res.end(); } catch {}
  }
  sessions.delete(code);
  return true;
}

export function getSession(code) {
  return sessions.get(code);
}

export function addLine(code, lineObj) {
  const s = sessions.get(code);
  if (!s) return false;
  s.lines.push(lineObj);
  const payload = JSON.stringify(lineObj);
  // Broadcast to all listeners (SSE)
  for (const res of s.listeners) {
    res.write(`data: ${payload}\n\n`);
    res.flush?.();
  }
  return true;
}

export function attachListener(code, res) {
  const s = sessions.get(code);
  if (!s || !s.active) return false;
  s.listeners.add(res);
  // Send existing lines so late joiners see history
  for (const line of s.lines) {
    res.write(`data: ${JSON.stringify(line)}\n\n`);
  }
  return true;
}

export function detachListener(code, res) {
  const s = sessions.get(code);
  if (!s) return;
  s.listeners.delete(res);
}
