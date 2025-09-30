// Simple in-memory session store (resets on each deploy)
const sessions = new Map(); // code -> { active: true, lines: [], listeners: Set(res) }

export function newCode() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

export function createSession(code) {
  sessions.set(code, { active: true, lines: [], listeners: new Set() });
  return code;
}

export function endSession(code) {
  const s = sessions.get(code);
  if (!s) return false;
  s.active = false;
  for (const res of s.listeners) {
    try {
      res.write?.(`event: end\ndata: {}\n\n`);
      res.flush?.();
      res.end?.();
    } catch {}
  }
  sessions.delete(code);
  return true;
}

export function getSession(code) {
  return sessions.get(code);
}

export function addLine(code, line) {
  const s = sessions.get(code);
  if (!s || !s.active) return false;
  s.lines.push(line);
  const payload = JSON.stringify(line);
  for (const res of s.listeners) {
    res.write?.(`data: ${payload}\n\n`);
    res.flush?.();
  }
  return true;
}

export function attachListener(code, res) {
  const s = sessions.get(code);
  if (!s || !s.active) return false;
  s.listeners.add(res);
  // send history
  for (const line of s.lines) {
    res.write?.(`data: ${JSON.stringify(line)}\n\n`);
  }
  return true;
}

export function detachListener(code, res) {
  const s = sessions.get(code);
  if (s) s.listeners.delete(res);
}
