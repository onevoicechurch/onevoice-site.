'use client';

import { useEffect, useRef, useState } from 'react';

// Language choices (AUTO lets the server auto-detect)
const LANGS = [
  { v: 'AUTO', label: 'Auto-detect' },
  { v: 'en', label: 'English (United States)' },
  { v: 'es', label: 'Spanish' },
  { v: 'pt', label: 'Portuguese' },
  { v: 'fr', label: 'French' },
  { v: 'de', label: 'German' },
];

export default function Operator() {
  const [code, setCode] = useState<string | null>(null);
  const [inputLang, setInputLang] = useState<string>('AUTO');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Mic OFF');
  const [log, setLog] = useState<{ ts: number; line: string }[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);

  // mic + timers + SSE
  const mediaRef = useRef<MediaStream | null>(null);
  const recRef = useRef<{ mr?: MediaRecorder; ctx?: AudioContext } | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadTimerRef = useRef<number | null>(null);
  const lastChunkAtRef = useRef<number>(0);
  const sseRef = useRef<EventSource | null>(null);

  function pushLog(line: string) {
    setLog((prev) => [{ ts: Date.now(), line }, ...prev].slice(0, 200));
  }

  // ---------------- Session + SSE ----------------

  async function createSession(lang = inputLang) {
    setErrorText(null);
    const r = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputLang: lang }),
    }).then((r) => r.json()).catch(() => ({ ok: false }));

    if (!r?.ok || !r?.code) {
      setErrorText('Failed to create session.');
      return null;
    }
    setCode(r.code);
    pushLog(`Session ${r.code} ready`);
    startSSE(r.code);
    return r.code as string;
  }

  function startSSE(c: string) {
    try { sseRef.current?.close(); } catch {}
    const es = new EventSource(`/api/stream?code=${encodeURIComponent(c)}`);
    sseRef.current = es;

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg?.type === 'transcript' && msg?.text) {
          pushLog(msg.text);
        }
        if (msg?.type === 'error' && msg?.message) {
          setErrorText(String(msg.message));
        }
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

  async function onChangeLang(v: string) {
    setInputLang(v);
    if (!code) return;
    await fetch('/api/session', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, inputLang: v }),
    }).catch(() => {});
  }

  // ---------------- Microphone ----------------

  async function toggleMic() {
    if (running) {
      await stopMic(true);
    } else {
      await startMic();
    }
  }

  function pickMime(): string {
    // Prefer OGG/Opus – Deepgram handles short OGG chunks best
    const candidates = [
      'audio/ogg;codecs=opus',
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mpeg', // last-ditch (browser dependent)
    ];
    for (const m of candidates) {
      // @ts-ignore
      if (window.MediaRecorder && MediaRecorder.isTypeSupported?.(m)) return m;
    }
    return ''; // let MediaRecorder decide
  }

  async function startMic() {
    const current = code || await createSession(inputLang);
    if (!current) return;

    try {
      setErrorText(null);

      // 1) get audio
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRef.current = stream;

      // 2) analyser for simple VAD
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new AudioCtx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      analyserRef.current = analyser;

      // 3) recorder (2s chunks), prefer OGG/Opus
      const mime = pickMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recRef.current = { mr, ctx };

      mr.ondataavailable = async (ev: BlobEvent) => {
        if (!ev.data || ev.data.size === 0) return;
        lastChunkAtRef.current = Date.now();

        const form = new FormData();
        form.append('audio', ev.data, mime.includes('ogg') ? 'chunk.ogg' : 'chunk.webm');
        form.append('code', current);
        form.append('lang', inputLang === 'AUTO' ? '' : inputLang);

        const res = await fetch('/api/ingest', { method: 'POST', body: form })
          .catch(() => null);

        if (res && !res.ok) {
          // surface server error to banner (includes Deepgram reason)
          try {
            const j = await res.json();
            if (j?.error) setErrorText(String(j.error));
          } catch {}
        }
      };

      // 2s chunks reduce container/headers issues
      mr.start(2000);

      // 4) tiny VAD flush
      const VAD_INTERVAL_MS = 200;
      const SILENCE_THRESHOLD = 0.015; // 0..1 RMS
      const MIN_SPEECH_MS = 2500;
      let silenceFor = 0;

      vadTimerRef.current = window.setInterval(async () => {
        const a = analyserRef.current;
        if (!a) return;
        const buf = new Uint8Array(a.frequencyBinCount);
        a.getByteTimeDomainData(buf);

        // simple RMS
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
      setErrorText('Microphone not available or permission denied.');
    }
  }

  async function stopMic(finalFlush = false) {
    setRunning(false);
    setStatus('Mic OFF');

    try { recRef.current?.mr?.stop(); } catch {}
    try { mediaRef.current?.getTracks?.().forEach((t) => t.stop()); } catch {}
    if (vadTimerRef.current) { clearInterval(vadTimerRef.current); vadTimerRef.current = null; }
    try { recRef.current?.ctx?.close(); } catch {}

    if (finalFlush && code) {
      await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      }).catch(() => {});
    }
  }

  // ---------------- UI ----------------

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
            {LANGS.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
          </select>
        </div>

        <button
          onClick={toggleMic}
          style={{ background: running ? '#16a34a' : '#ef4444', color: '#fff', padding: '6px 12px', borderRadius: 6 }}
        >
          {running ? 'Mic ON' : 'Mic OFF'}
        </button>
        <button onClick={() => stopMic(true)}>End Session</button>
        <div> Status: {status}</div>
      </div>

      {errorText && (
        <div style={{
          background: '#fee2e2', color: '#7f1d1d', padding: '10px 12px',
          borderRadius: 8, marginTop: 16, whiteSpace: 'pre-wrap'
        }}>
          {errorText}
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
