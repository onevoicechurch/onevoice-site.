'use client';

import { useEffect, useRef, useState } from 'react';

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
  const [errorText, setErrorText] = useState(null);
  const [log, setLog] = useState([]);

  const mediaRef = useRef(null);
  const recRef = useRef(null);
  const vadTimerRef = useRef(null);
  const lastChunkAtRef = useRef(0);
  const sseRef = useRef(null);

  function pushLog(line) {
    setLog(prev => [{ ts: Date.now(), line }, ...prev].slice(0, 200));
  }

  async function createSession(lang) {
    const r = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputLang: lang ?? inputLang })
    }).then(r => r.json()).catch(() => ({ ok: false }));

    if (!r?.ok || !r?.code) {
      setErrorText('Failed to create session');
      return null;
    }
    setCode(r.code);
    setErrorText(null);
    pushLog(`Session ${r.code} ready`);
    startSSE(r.code);
    return r.code;
  }

  function startSSE(c) {
    try { sseRef.current?.close?.(); } catch {}
    const es = new EventSource(`/api/stream?code=${encodeURIComponent(c)}`);
    sseRef.current = es;
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg?.type === 'transcript' && msg?.text) pushLog(msg.text);
      } catch {}
    };
    es.onerror = () => { try { es.close(); } catch {}; setTimeout(() => startSSE(c), 1000); };
  }

  useEffect(() => {
    createSession();
    return () => { try { sseRef.current?.close(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onChangeLang(v) {
    setInputLang(v);
    if (!code) return;
    await fetch('/api/session', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, inputLang: v })
    }).catch(() => {});
  }

  async function toggleMic() {
    if (running) await stopMic(true);
    else await startMic();
  }

  function pickMime() {
    // Prefer webm/opus, then ogg/opus, else let the browser pick.
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
    if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus'))  return 'audio/ogg;codecs=opus';
    if (MediaRecorder.isTypeSupported('audio/webm'))             return 'audio/webm';
    return ''; // let browser choose
  }

  async function startMic() {
    const current = code || await createSession(inputLang);
    if (!current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRef.current = stream;

      const mime = pickMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      recRef.current = mr;

      mr.ondataavailable = async (ev) => {
        if (!ev.data || ev.data.size === 0) return;
        lastChunkAtRef.current = Date.now();

        // Send **raw bytes** with an explicit MIME header so the server can pass it through.
        await fetch(`/api/ingest?code=${encodeURIComponent(current)}&lang=${encodeURIComponent(inputLang)}`, {
          method: 'POST',
          headers: { 'x-audio-mime': ev.data.type || mime || 'application/octet-stream' },
          body: ev.data
        }).catch(() => {});
      };

      // Use slightly bigger chunks (1.5–2s) so Deepgram definitely has enough audio per request.
      mr.start(1800);

      // simple “flush tick” after short silence
      lastChunkAtRef.current = Date.now();
      vadTimerRef.current = setInterval(async () => {
        if (!running) return;
        const since = Date.now() - lastChunkAtRef.current;
        if (since > 2600) {
          await fetch(`/api/ingest?code=${encodeURIComponent(current)}&lang=${encodeURIComponent(inputLang)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tick: 1 })
          }).catch(() => {});
          lastChunkAtRef.current = Date.now();
        }
      }, 800);

      setRunning(true);
      setStatus('Mic ON');
      setErrorText(null);
    } catch (err) {
      console.error(err);
      setErrorText('Microphone not available or permission denied.');
    }
  }

  async function stopMic(finalFlush) {
    setRunning(false);
    setStatus('Mic OFF');

    try { recRef.current?.stop(); } catch {}
    try { mediaRef.current?.getTracks?.().forEach(t => t.stop()); } catch {}
    try { clearInterval(vadTimerRef.current); } catch {}

    if (finalFlush && code) {
      await fetch(`/api/ingest?code=${encodeURIComponent(code)}&lang=${encodeURIComponent(inputLang)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ final: 1 })
      }).catch(() => {});
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 28, marginBottom: 12 }}>🖥️ Operator Console (Whisper)</h1>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div><b>Access Code:</b> {code || '----'}</div>
        <button onClick={() => createSession()}>New Session</button>
        <a href={code ? `/s/${code}` : '#'} target="_blank" rel="noreferrer">Open Listener</a>

        <div>
          <label>Input language:&nbsp;</label>
          <select value={inputLang} onChange={(e) => onChangeLang(e.target.value)}>
            {LANGS.map(l => <option key={l.v} value={l.v}>{l.label}</option>)}
          </select>
        </div>

        <button
          onClick={toggleMic}
          style={{ background: running ? '#16a34a' : '#ef4444', color:'#fff', padding:'6px 12px', borderRadius:6 }}
        >
          {running ? 'Mic ON' : 'Mic OFF'}
        </button>

        <button onClick={() => stopMic(true)}>End Session</button>
        <div> Status: {status}</div>
      </div>

      {errorText ? (
        <div style={{ marginTop: 12, background:'#fde2e2', color:'#7f1d1d', padding:12, borderRadius:6 }}>
          {errorText}
        </div>
      ) : null}

      <h3 style={{ marginTop: 24 }}>Live Preview (spoken text)</h3>
      <div style={{ background:'#0f1820', color:'#dfe7ef', padding:16, borderRadius:8, minHeight:160 }}>
        {log.map((r,i)=>(
          <div key={i} style={{ opacity: i?0.8:1 }}>
            <small>{new Date(r.ts).toLocaleTimeString()} — </small> {r.line}
          </div>
        ))}
      </div>
    </div>
  );
}
