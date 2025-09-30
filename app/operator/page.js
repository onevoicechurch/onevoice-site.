'use client';
import { useEffect, useRef, useState } from 'react';

const SEG_MS = 5000; // finalized 5s chunks (no half-baked containers)

export default function OperatorPage() {
  const [code, setCode] = useState('');
  const [inputLang, setInputLang] = useState('English (United States)');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [log, setLog] = useState([]);

  const mediaRef = useRef(/** @type {MediaStream|null} */(null));
  const recRef   = useRef(/** @type {MediaRecorder|null} */(null));
  const esRef    = useRef(/** @type {EventSource|null} */(null));

  // ---------- Session ----------
  async function newSession() {
    setStatus('Creating session…');
    const r = await fetch('/api/session', { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    if (!j?.code) { setStatus('Failed to create session'); return; }
    setCode(j.code);
    setLog([]);
    setStatus('Session ready');
  }

  async function endSession() {
    if (code) {
      try { await fetch(`/api/session?code=${code}`, { method: 'DELETE' }); } catch {}
    }
    stopMic();
    esRef.current?.close();
    esRef.current = null;
    setStatus('Session ended');
  }

  // ---------- SSE live preview ----------
  useEffect(() => {
    if (!code) return;
    esRef.current?.close();
    const es = new EventSource(`/api/stream?code=${code}`);
    esRef.current = es;

    es.onopen = () => setStatus('Connected to preview');
    es.onerror = () => setStatus('Preview stream error (auto-retry)…');
    es.onmessage = (ev) => {
      try {
        const line = JSON.parse(ev.data);
        const text = line.text || line.en || line.src || '';
        if (!text) return;
        setLog((prev) => [...prev, { ts: line.ts || Date.now(), text }]);
      } catch {}
    };
    return () => es.close();
  }, [code]);

  // ---------- Mic (segmented recorder) ----------
  async function startMic() {
    if (!code) await newSession();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true },
        video: false,
      });
      mediaRef.current = stream;
      setRunning(true);

      const mimeType =
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
        MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
        MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' :
        '';

      let recorder;
      let segTimer = 0;

      const startRecorder = () => {
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

        recorder.ondataavailable = async (e) => {
          if (!e.data || e.data.size < 6000) return;
          try {
            const qs = new URLSearchParams({
              code,
              inputLang: toBCP47(inputLang), // "English (United States)" -> "en-US"
            });
            const ab = await e.data.arrayBuffer();
            const r = await fetch('/api/ingest?' + qs.toString(), {
              method: 'POST',
              headers: { 'Content-Type': e.data.type || 'audio/webm' },
              body: ab,
            });
            const ok = (await r.json().catch(() => ({})))?.ok;
            setStatus(ok ? 'Chunk processed' : 'Chunk error');
          } catch (err) {
            console.error('ingest send error', err);
            setStatus('Upload error');
          }
        };

        recorder.onstart = () => {
          segTimer = window.setTimeout(() => {
            try { recorder.state !== 'inactive' && recorder.stop(); } catch {}
          }, SEG_MS);
        };

        recorder.onstop = () => {
          window.clearTimeout(segTimer);
          if (running && mediaRef.current) startRecorder();
        };

        recorder.start();
        recRef.current = recorder;
        setStatus('Recording…');
      };

      startRecorder();
    } catch (err) {
      console.error(err);
      setStatus('Mic permission/initialization failed');
    }
  }

  function stopMic() {
    setRunning(false);
    try { recRef.current && recRef.current.state !== 'inactive' && recRef.current.stop(); } catch {}
    if (mediaRef.current) {
      mediaRef.current.getTracks().forEach((t) => t.stop());
      mediaRef.current = null;
    }
    setStatus('Mic off');
  }

  function toBCP47(label) {
    if (!label || label.toUpperCase() === 'AUTO') return 'AUTO';
    if (label.includes('English')) return 'en-US';
    // extend mapping as you add options
    return 'AUTO';
  }

  // create a session on first load
  useEffect(() => { if (!code) newSession(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="page">
      <h1>🎛️ Operator Console (Whisper)</h1>

      <div className="row">
        <div><b>Access Code</b> <span className="pill">{code || '—'}</span></div>
        <button onClick={newSession}>New Session</button>
        <a href={code ? `/s/${code}` : '#'} target="_blank" rel="noreferrer">Open Listener</a>
      </div>

      <div className="row">
        <label>Input language:&nbsp;
          <select value={inputLang} onChange={(e)=>setInputLang(e.target.value)}>
            <option>English (United States)</option>
            <option>AUTO</option>
          </select>
        </label>

        {!running ? (
          <button className="danger" onClick={startMic}>🎙️ Mic ON</button>
        ) : (
          <button className="danger" onClick={stopMic}>🛑 Mic OFF</button>
        )}

        <button onClick={endSession}>End Session</button>
        <span style={{marginLeft:12}}>Status: <i>{status}</i></span>
      </div>

      <h3>Live Preview (spoken text)</h3>
      <div className="console">
        {log.map((l, i) => (
          <div key={l.ts + ':' + i} className="line">
            <span className="ts">{new Date(l.ts).toLocaleTimeString()}</span>
            <span className="bubble">🗣️ {l.text}</span>
          </div>
        ))}
      </div>

      <style jsx>{`
        .page { max-width: 980px; margin: 32px auto; color: #e9eef7; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto; }
        h1 { font-weight: 700; }
        .row { display: flex; align-items: center; gap: 12px; margin: 8px 0 16px; flex-wrap: wrap; }
        .pill { padding: 6px 10px; border-radius: 8px; background: #0f233a; display: inline-block; min-width: 64px; text-align: center; }
        button { padding: 8px 12px; border-radius: 8px; border: none; background: #1f4a7a; color: #fff; cursor: pointer; }
        button.danger { background: #d1475b; }
        .console { background:#0b1726; border-radius:12px; padding:14px 16px; min-height: 220px; }
        .line { margin: 6px 0; }
        .ts { color:#8aa2c2; font-size:12px; margin-right:8px; }
        .bubble { display:inline-block; }
      `}</style>
    </div>
  );
}
