'use client';

import { useEffect, useRef, useState } from 'react';

// Shown in the dropdown (AUTO = server will detect language)
const LANGS = [
  { v: 'AUTO', label: 'Auto-detect' },
  { v: 'en',   label: 'English (United States)' },
  { v: 'es',   label: 'Spanish' },
  { v: 'pt',   label: 'Portuguese' },
  { v: 'fr',   label: 'French' },
  { v: 'de',   label: 'German' },
];

export default function Operator() {
  const [code, setCode] = useState(null);
  const [inputLang, setInputLang] = useState('AUTO');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Mic OFF');
  const [log, setLog] = useState([]);
  const [error, setError] = useState('');

  // mic / timers / SSE handles
  const mediaRef = useRef(null);
  const recRef   = useRef(null);
  const vadTimerRef = useRef(null);
  const lastChunkAtRef = useRef(0);
  const sseRef = useRef(null);

  function pushLog(line) {
    setLog(prev => [{ ts: Date.now(), line }, ...prev].slice(0, 200));
  }

  // ---------------- Session + SSE ----------------

  async function createSession(lang = inputLang) {
    setError('');
    const r = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputLang: lang }),
    }).then(r => r.json()).catch(() => ({ ok: false }));

    if (!r?.ok || !r?.code) {
      setError('Failed to create session.');
      return null;
    }
    setCode(r.code);
    pushLog(`Session ${r.code} ready`);
    startSSE(r.code);
    return r.code;
  }

  function startSSE(c) {
    try { sseRef.current?.close(); } catch {}
    const es = new EventSource(`/api/stream?code=${encodeURIComponent(c)}`);
    sseRef.current = es;

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg?.type === 'transcript' && msg?.text) pushLog(msg.text);
      } catch {}
    };

    es.onerror = () => {
      try { es.close(); } catch {}
      setTimeout(() => startSSE(c), 1000);
    };
  }

  useEffect(() => {
    createSession();
    return () => { try { sseRef.current?.close(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updateSessionLang(v) {
    setInputLang(v);
    if (!code) return;
    await fetch('/api/session', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, inputLang: v }),
    }).catch(() => {});
  }

  // ---------------- Mic control ----------------

  async function toggleMic() {
    if (running) await stopMic(true);
    else await startMic();
  }

  async function startMic() {
    const current = code || await createSession(inputLang);
    if (!current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRef.current = stream;

      // Pick a supported MediaRecorder mime type
      let mime = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mime)) {
        if (MediaRecorder.isTypeSupported('audio/webm')) mime = 'audio/webm';
        else if (MediaRecorder.isTypeSupported('audio/ogg')) mime = 'audio/ogg';
        else if (MediaRecorder.isTypeSupported('audio/mpeg')) mime = 'audio/mpeg';
        else mime = '';
      }

      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recRef.current = { mr };

      mr.ondataavailable = async (ev) => {
        if (!ev.data || ev.data.size === 0) return;
        lastChunkAtRef.current = Date.now();

        const form = new FormData();
        form.append('audio', ev.data, 'chunk.webm'); // filename is arbitrary
        form.append('code', current);
        form.append('lang', inputLang === 'AUTO' ? '' : inputLang);

        // Send to /api/ingest (server will normalize content-type for Deepgram)
        const res = await fetch('/api/ingest', { method: 'POST', body: form }).catch(() => null);
        if (!res) return;
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setError(j?.error || 'Ingest error');
        }
      };

      mr.start(1000); // ~1s chunks

      // Tiny silence-aware flush ping: if user pauses, nudge server to emit
      lastChunkAtRef.current = Date.now();
      vadTimerRef.current = setInterval(async () => {
        const since = Date.now() - lastChunkAtRef.current;
        if (since > 2600) {
          await fetch('/api/ingest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: current })
          }).catch(() => {});
          lastChunkAtRef.current = Date.now();
        }
      }, 600);

      setRunning(true);
      setStatus('Mic ON');
      setError('');
    } catch (e) {
      console.error(e);
      setError('Microphone not available or permission denied.');
    }
  }

  async function stopMic(finalFlush = false) {
    setRunning(false);
    setStatus('Mic OFF');

    try { recRef.current?.mr?.stop(); } catch {}
    try { mediaRef.current?.getTracks?.().forEach(t => t.stop()); } catch {}
    try { clearInterval(vadTimerRef.current); } catch {}

    if (finalFlush && code) {
      await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      }).catch(() => {});
    }
  }

  // ---------------- UI ----------------

  return (
    <div style={{ padding: '24px', maxWidth: 1000, margin: '0 auto', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      <h1 style={{ fontSize: 28, marginBottom: 12 }}>🖥️ Operator Console (Whisper)</h1>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div><b>Access Code:</b> {code || '----'}</div>
        <button onClick={() => createSession()}>New Session</button>
        <a href={code ? `/s/${code}` : '#'} target="_blank" rel="noreferrer">Open Listener</a>

        <label>
          &nbsp;Input language:&nbsp;
          <select value={inputLang} onChange={e => updateSessionLang(e.target.value)}>
            {LANGS.map(l => <option key={l.v} value={l.v}>{l.label}</option>)}
          </select>
        </label>

        <button
          onClick={toggleMic}
          style={{
            background: running ? '#16a34a' : '#ef4444',
            color: '#fff', padding: '6px 12px', borderRadius: 6
          }}
        >
          {running ? 'Mic ON' : 'Mic OFF'}
        </button>

        <button onClick={() => stopMic(true)}>End Session</button>
        <div> Status: {status}</div>
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: '#fee2e2', color: '#7f1d1d', borderRadius: 6 }}>
          {error}
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>Live Preview (spoken text)</h3>
      <div style={{ background: '#0f1820', color: '#dfe7ef', padding: 16, borderRadius: 8, minHeight: 160 }}>
        {log.map((r, i) => (
          <div key={i} style={{ opacity: i ? 0.8 : 1 }}>
            <small>{new Date(r.ts).toLocaleTimeString()} — </small> {r.line}
          </div>
        ))}
      </div>
    </div>
  );
}
