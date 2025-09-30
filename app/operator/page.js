'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * ===== Speech capture tuning =====
 * We record continuously but only SEND when we detect a pause.
 * - We accumulate tiny MediaRecorder chunks (250ms each) into `segParts`.
 * - While you speak (RMS above threshold), we keep accumulating.
 * - When we've had PAUSE_MS of silence and the segment is at least MIN_SEG_MS,
 *   we finalize the blob and POST it to /api/ingest.
 */
const CHUNK_MS     = 250;     // recorder timeslice (small = lower latency)
const PAUSE_MS     = 900;     // how long silence must last to finalize a segment
const MIN_SEG_MS   = 2500;    // don't send ultra-short segments
const MIN_SEND_B   = 7000;    // server-side is happier with containers > ~6–7 KB
const SILENCE_RMS  = 0.012;   // tweak if your room is noisier/quieter

// A compact list that still covers most cases. Users can still choose AUTO.
const INPUT_LANGS = [
  { code: 'AUTO',  label: 'Auto-detect (Whisper)' },
  { code: 'en-US', label: 'English (United States)' },
  { code: 'es-ES', label: 'Spanish (Spain)' },
  { code: 'es-MX', label: 'Spanish (Mexico)' },
  { code: 'vi-VN', label: 'Vietnamese' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)' },
  { code: 'fr-FR', label: 'French' },
  { code: 'zh',    label: 'Chinese' },
];

export default function Operator() {
  const [code, setCode]             = useState(null);
  const [inputLang, setInputLang]   = useState('AUTO');
  const [running, setRunning]       = useState(false);
  const [log, setLog]               = useState([]);

  // media & analysis
  const mediaRef    = useRef(null);
  const recRef      = useRef(null);
  const ctxRef      = useRef(null);
  const analyserRef = useRef(null);
  const dataRef     = useRef(null);

  // segment accumulation
  const segPartsRef      = useRef([]);     // array of small blobs
  const segStartedAtRef  = useRef(0);      // ms
  const lastVoiceAtRef   = useRef(0);      // ms (last time we were "speaking")
  const monitorIdRef     = useRef(0);

  // boot
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setCode(
      localStorage.getItem('ov:lastCode') ||
      Math.random().toString(36).slice(2, 6).toUpperCase()
    );
    setInputLang(localStorage.getItem('ov:inputLang') || 'AUTO');
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (code) localStorage.setItem('ov:lastCode', code);
    localStorage.setItem('ov:inputLang', inputLang);
  }, [code, inputLang]);

  // live preview via SSE
  useEffect(() => {
    if (!code) return;
    const es = new EventSource(`/api/stream?code=${encodeURIComponent(code)}`);
    es.onmessage = (e) => {
      try {
        const line = JSON.parse(e.data);               // { ts, en, ... }
        if (!line?.en) return;
        setLog((prev) => [...prev, { ts: line.ts, en: line.en }].slice(-200));
      } catch {}
    };
    es.addEventListener('end', () => es.close());
    return () => es.close();
  }, [code]);

  async function newSession() {
    const r = await fetch('/api/session', { method: 'POST' });
    const j = await r.json();
    if (j.code) setCode(j.code);
    setLog([]);
  }
  async function endSession() {
    if (!code) return;
    await fetch(`/api/session?code=${encodeURIComponent(code)}`, { method: 'DELETE' });
    stopMic();
    setLog([]);
  }

  function rms() {
    // quick RMS from time-domain data [0..255]
    const analyser = analyserRef.current;
    const data = dataRef.current;
    if (!analyser || !data) return 0;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128; // -1..1
      sum += v * v;
    }
    return Math.sqrt(sum / data.length);
  }

  function finalizeIfReady(force = false) {
    const now = Date.now();
    const segMs = now - segStartedAtRef.current;
    const silentLongEnough = (now - lastVoiceAtRef.current) >= PAUSE_MS;
    const okToSend = segMs >= MIN_SEG_MS && silentLongEnough;

    if (force || okToSend) {
      const parts = segPartsRef.current;
      if (!parts.length) return;
      const blob = new Blob(parts, { type: parts[0]?.type || 'audio/webm' });
      // reset accumulators *before* posting so we never lose fresh audio
      segPartsRef.current = [];
      segStartedAtRef.current = Date.now();
      postSegment(blob);
    }
  }

  async function postSegment(blob) {
    if (!blob || blob.size < MIN_SEND_B) return;
    try {
      const ab = await blob.arrayBuffer();
      const qs = new URLSearchParams({
        code: code || '',
        inputLang,
      });
      await fetch('/api/ingest?' + qs.toString(), {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'audio/webm' },
        body: ab,
      });
    } catch (err) {
      console.error('ingest send error', err);
    }
  }

  async function startMic() {
    // media
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true },
      video: false,
    });
    mediaRef.current = stream;

    // audio graph for VAD
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctxRef.current = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyserRef.current = analyser;
    dataRef.current = new Uint8Array(analyser.fftSize);
    src.connect(analyser);

    // choose compatible container
    const mimeType =
      MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
      MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
      MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : '';

    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recRef.current = rec;

    segPartsRef.current = [];
    segStartedAtRef.current = Date.now();
    lastVoiceAtRef.current = Date.now();

    rec.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      segPartsRef.current.push(e.data);
    };

    rec.start(CHUNK_MS);
    setRunning(true);

    // monitor loop
    function tick() {
      const level = rms();
      const now = Date.now();
      if (level > SILENCE_RMS) {
        lastVoiceAtRef.current = now;
      } else {
        // we’re in silence; see if it’s time to ship a segment
        finalizeIfReady(false);
      }
      monitorIdRef.current = window.setTimeout(tick, 80);
    }
    tick();
  }

  function stopMic() {
    setRunning(false);
    try { finalizeIfReady(true); } catch {}
    try { recRef.current && recRef.current.state !== 'inactive' && recRef.current.stop(); } catch {}
    if (mediaRef.current) {
      mediaRef.current.getTracks().forEach((t) => t.stop());
      mediaRef.current = null;
    }
    if (monitorIdRef.current) window.clearTimeout(monitorIdRef.current);
    try { ctxRef.current && ctxRef.current.close(); } catch {}
  }

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://onevoice.church';
  const listenerUrl = code ? `${origin}/s/${encodeURIComponent(code)}` : '#';
  const qrUrl = code
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(listenerUrl)}`
    : '';

  return (
    <main style={{ minHeight: '100vh', padding: 24, color: 'white', background: 'linear-gradient(135deg,#0e1a2b,#153a74 60%,#0f3070)' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <h1>🎛️ Operator Console (Whisper)</h1>
        <p style={{ opacity: 0.9 }}>Share the code/QR. Pick input language (or Auto). Start the mic.</p>

        {code && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center' }}>
            <div>
              <div style={{ marginBottom: 6 }}>Access Code</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <code style={{ background: 'rgba(255,255,255,0.15)', padding: '6px 10px', borderRadius: 8, fontSize: 20 }}>{code}</code>
                <button onClick={newSession} style={{ padding: '8px 12px', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>New Session</button>
                <a href={listenerUrl} target="_blank" rel="noreferrer" style={{ color: 'white', textDecoration: 'underline' }}>Open Listener</a>
              </div>
            </div>
            <div style={{ justifySelf: 'end' }}>
              {qrUrl && <img src={qrUrl} alt="QR" width={120} height={120} style={{ background: 'white', borderRadius: 8 }} />}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
          <label>
            <span style={{ marginRight: 8 }}>Input language:</span>
            <select value={inputLang} onChange={(e) => setInputLang(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
              {INPUT_LANGS.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>

          {!running ? (
            <button onClick={startMic} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', fontWeight: 700, cursor: 'pointer' }}>
              🎙️ Mic ON
            </button>
          ) : (
            <button onClick={stopMic} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', background: '#ff5555', color: 'white', fontWeight: 700, cursor: 'pointer' }}>
              ⏹️ Mic OFF
            </button>
          )}

          <button onClick={endSession} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.5)', cursor: 'pointer' }}>
            End Session
          </button>
        </div>

        <h3 style={{ marginTop: 18 }}>Live Preview (spoken text)</h3>
        <div style={{ background: '#0b1220', color: 'white', padding: 12, borderRadius: 8, minHeight: 220, lineHeight: 1.6 }}>
          {log.map((l, i) => (
            <div key={l.ts + '-' + i} style={{ marginBottom: 10 }}>
              <div style={{ opacity: 0.6, fontSize: 12 }}>{new Date(l.ts).toLocaleTimeString()}</div>
              <div>🗣️ {l.en}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
