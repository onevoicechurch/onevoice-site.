'use client';

import { useEffect, useRef, useState } from 'react';

// UI: language dropdown (AUTO means server will auto-detect)
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

  // refs for mic + timers + SSE
  const mediaRef = useRef(null);
  const recRef = useRef(null);
  const analyserRef = useRef(null);
  const vadTimerRef = useRef(null);
  const lastChunkAtRef = useRef(0);
  const sseRef = useRef(null);

  // simple log helper (shows newest on top)
  function pushLog(line) {
    setLog(prev => [{ ts: Date.now(), line }, ...prev].slice(0, 200));
  }

  // --- Session + SSE ---------------------------------------------------------

  async function createSession(lang = inputLang) {
    const r = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputLang: lang }),
    }).then(r => r.json()).catch(() => ({ ok: false }));

    if (!r?.ok || !r?.code) {
      pushLog('❌ Failed to create session');
      return null;
    }
    setCode(r.code);
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
        if (msg?.type === 'transcript' && msg?.text) {
          pushLog(msg.text);
        }
      } catch {}
    };

    es.onerror = () => {
      // quiet auto-reconnect
      try { es.close(); } catch {}
      setTimeout(() => startSSE(c), 1000);
    };
  }

  // create a session on first load
  useEffect(() => {
    createSession();
    return () => { try { sseRef.current?.close(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // allow changing input language mid-session
  async function onChangeLang(v) {
    setInputLang(v);
    if (!code) return;
    await fetch('/api/session', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, inputLang: v }),
    }).catch(() => {});
  }

  // --- Microphone start/stop --------------------------------------------------

  async function toggleMic() {
    if (running) {
      await stopMic(true);
    } else {
      await startMic();
    }
  }

  async function startMic() {
    const current = code || await createSession(inputLang);
    if (!current) return;

    try {
      // 1) get audio
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRef.current = stream;

      // 2) analyser for simple VAD (silence detection)
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      analyserRef.current = analyser;

      // 3) recorder (1s chunks). pick best supported mime
      let mime = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mime)) mime = 'audio/webm';
      const mr = new MediaRecorder(stream, { mimeType: mime });
      recRef.current = { mr, ctx };

      mr.ondataavailable = async (ev) => {
        if (!ev.data || ev.data.size === 0) return;
        lastChunkAtRef.current = Date.now();

        const form = new FormData();
        form.append('audio', ev.data, 'chunk.webm');
        form.append('code', current);
        form.append('lang', inputLang === 'AUTO' ? '' : inputLang);

        // new ingest expects multipart/form-data
        await fetch('/api/ingest', { method: 'POST', body: form }).catch(() => {});
      };

      mr.start(1000); // chunk every ~1s

      // 4) tiny VAD that asks server to finalize bursts after short silence
      const VAD_INTERVAL_MS = 200;
      const SILENCE_THRESHOLD = 0.015; // tweak
      const MIN_SPEECH_MS = 2500;
      let silenceFor = 0;

      vadTimerRef.current = setInterval(async () => {
        const buf = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteTimeDomainData(buf);

        // RMS (0..1-ish)
        let mean = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          mean += v * v;
        }
        mean = Math.sqrt(mean / buf.length);

        const silent = mean < SILENCE_THRESHOLD;
        silenceFor = silent ? silenceFor + VAD_INTERVAL_MS : 0;

        const sinceLast = Date.now() - lastChunkAtRef.current;
        if (sinceLast > MIN_SPEECH_MS && silenceFor > 600) {
          // ping to encourage server to emit a message promptly
          await fetch('/api/ingest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: current }),
          }).catch(() => {});
          lastChunkAtRef.current = Date.now();
        }
      }, VAD_INTERVAL_MS);

      // UI
      setRunning(true);
      setStatus('Mic ON');
    } catch (err) {
      console.error(err);
      alert('Microphone not available or permission denied.');
    }
  }

  async function stopMic(finalFlush = false) {
    setRunning(false);
    setStatus('Mic OFF');

    try { recRef.current?.mr?.stop(); } catch {}
    try { mediaRef.current?.getTracks?.().forEach(t => t.stop()); } catch {}
    try { clearInterval(vadTimerRef.current); } catch {}
    try { recRef.current?.ctx?.close(); } catch {}

    if (finalFlush && code) {
      // JSON ping is fine (server treats no-audio as a flush tick)
      await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      }).catch(() => {});
    }
  }

  // --- UI --------------------------------------------------------------------

  return (
    <div style={{ padding: '24px', maxWidth: 1000, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
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
          style={{
            background: running ? '#16a34a' : '#ef4444',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: 6
          }}
        >
          {running ? 'Mic ON' : 'Mic OFF'}
        </button>

        <button onClick={() => stopMic(true)}>End Session</button>
        <div> Status: {status}</div>
      </div>

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
