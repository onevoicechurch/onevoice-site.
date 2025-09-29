'use client'; // must be first

import { useEffect, useRef, useState } from 'react';

const INPUT_LANGS = [
  { code: 'AUTO', label: 'Auto-detect (Whisper)' },
  { code: 'en-US', label: 'English (United States)' },
  { code: 'en-GB', label: 'English (United Kingdom)' },
  { code: 'en-AU', label: 'English (Australia)' },
  { code: 'en-CA', label: 'English (Canada)' },
  { code: 'es-US', label: 'Spanish (United States)' },
  { code: 'es-ES', label: 'Spanish (Spain)' },
  { code: 'es-MX', label: 'Spanish (Mexico)' },
  { code: 'vi-VN', label: 'Vietnamese (Vietnam)' },
];

/** ===== Utterance controls =====
 * We record continuously, but automatically STOP on silence or time cap.
 * Stopping produces a COMPLETE file with headers (fixes 400s),
 * then we immediately START a new recorder (continuous feel).
 */
const PAUSE_MS         = 900;   // silence that ends an utterance
const MAX_UTTER_MS     = 8000;  // hard cap (flush even if still speaking)
const ENERGY_THRESHOLD = 0.012; // VAD threshold (raise if noisy room)
const MIN_SEND_B       = 6000;  // ignore tiny files (avoid 400s)
const VAD_CHECK_MS     = 100;   // how often to sample loudness
/** ============================= */

export default function Operator() {
  const [code, setCode] = useState(null);
  const [inputLang, setInputLang] = useState('AUTO');
  const [langsCsv, setLangsCsv] = useState('es,vi,zh');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);

  const mediaRef = useRef(null);

  // Recorder state for the CURRENT utterance
  const recRef = useRef(null);
  const curChunksRef = useRef([]);     // chunks for current utterance
  const curTypeRef = useRef('audio/webm');
  const utterStartAtRef = useRef(0);
  const lastSpeechAtRef = useRef(0);
  const speakingRef = useRef(false);

  // VAD
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const vadTimerRef = useRef(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://onevoice.church';
  const listenerUrl = code ? `${origin}/s/${encodeURIComponent(code)}` : '#';
  const qrUrl = code
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(listenerUrl)}`
    : '';

  // load/persist simple prefs
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setCode(localStorage.getItem('ov:lastCode') || Math.random().toString(36).slice(2, 6).toUpperCase());
    setInputLang(localStorage.getItem('ov:inputLang') || 'AUTO');
    setLangsCsv(localStorage.getItem('ov:langs') || 'es,vi,zh');
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (code) localStorage.setItem('ov:lastCode', code);
    localStorage.setItem('ov:inputLang', inputLang);
    localStorage.setItem('ov:langs', langsCsv);
  }, [code, inputLang, langsCsv]);

  // live preview via SSE
  useEffect(() => {
    if (!code) return;
    const es = new EventSource(`/api/stream?code=${encodeURIComponent(code)}`);
    es.onmessage = (e) => {
      try {
        const line = JSON.parse(e.data);
        setLog((prev) => [...prev, line].slice(-200));
      } catch {}
    };
    es.addEventListener('end', () => es.close());
    return () => es.close();
  }, [code]);

  async function newSession() {
    const r = await fetch('/api/session', { method: 'POST' });
    const j = await r.json();
    if (j.code) setCode(j.code);
  }

  async function endSession() {
    if (!code) return;
    await fetch(`/api/session?code=${encodeURIComponent(code)}`, { method: 'DELETE' });
    stopMic();
    setLog([]);
  }

  async function startMic() {
    // 1) Mic
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true },
      video: false,
    });
    mediaRef.current = stream;

    // 2) WebAudio analyser for VAD
    audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtxRef.current.createMediaStreamSource(stream);
    analyserRef.current = audioCtxRef.current.createAnalyser();
    analyserRef.current.fftSize = 2048;
    source.connect(analyserRef.current);

    // 3) Start first utterance recorder (no timeslice)
    startNewRecorder(stream);

    // 4) VAD loop: when pause or max reached → stop current recorder (flush file), then restart
    const buf = new Uint8Array(analyserRef.current.fftSize);
    utterStartAtRef.current = performance.now();
    lastSpeechAtRef.current = performance.now();
    speakingRef.current = false;

    vadTimerRef.current = window.setInterval(() => {
      analyserRef.current.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);

      const now = performance.now();
      const speaking = rms > ENERGY_THRESHOLD;

      if (speaking) {
        speakingRef.current = true;
        lastSpeechAtRef.current = now;
      }

      const longEnough = now - utterStartAtRef.current >= MAX_UTTER_MS;
      const paused = speakingRef.current && (now - lastSpeechAtRef.current >= PAUSE_MS);

      if (paused || longEnough) {
        // stop current recorder → onstop will send the complete file, then immediately start a new recorder
        try { recRef.current && recRef.current.state === 'recording' && recRef.current.stop(); } catch {}
      }
    }, VAD_CHECK_MS);

    setRunning(true);
  }

  function startNewRecorder(stream) {
    // Pick a supported mime (Chrome: webm/opus; Safari likely mp4)
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/mpeg',
      ''
    ];
    let chosen = types.find(t => { try { return t && MediaRecorder.isTypeSupported(t); } catch { return false; } }) || '';
    const rec = chosen ? new MediaRecorder(stream, { mimeType: chosen }) : new MediaRecorder(stream);
    recRef.current = rec;
    curTypeRef.current = rec.mimeType || 'audio/webm';
    curChunksRef.current = [];
    utterStartAtRef.current = performance.now();
    speakingRef.current = false;

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) {
        curChunksRef.current.push(e.data);
      }
    };

    rec.onstop = () => {
      // Build COMPLETE file (has headers) from all chunks of this utterance
      const blob = new Blob(curChunksRef.current, { type: curTypeRef.current || 'audio/webm' });
      curChunksRef.current = [];
      if (blob.size >= MIN_SEND_B) {
        void sendUtterance(blob);
      }
      // Immediately start the next utterance
      try { recRef.current = null; } catch {}
      startNewRecorder(stream);
    };

    rec.start(); // NO timeslice ⇒ 1 file per utterance (on stop)
  }

  async function sendUtterance(blob) {
    try {
      const qs = new URLSearchParams({
        code: code || '',
        inputLang,
        langs: (langsCsv || 'es').replace(/\s+/g, ''),
      });
      const ab = await blob.arrayBuffer();
      await fetch('/api/ingest?' + qs.toString(), {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'audio/webm' },
        body: ab,
      });
    } catch (err) {
      console.error('sendUtterance error', err);
    }
  }

  function stopMic() {
    // stop VAD
    if (vadTimerRef.current) clearInterval(vadTimerRef.current);
    // stop recorder
    try { recRef.current && recRef.current.state === 'recording' && recRef.current.stop(); } catch {}
    // stop tracks
    if (mediaRef.current) {
      mediaRef.current.getTracks().forEach(t => t.stop());
      mediaRef.current = null;
    }
    // close audio ctx
    try { audioCtxRef.current && audioCtxRef.current.close(); } catch {}
    setRunning(false);
  }

  const firstLang = (langsCsv || 'es').split(',')[0].trim() || 'es';

  return (
    <main style={{ minHeight: '100vh', padding: 24, color: 'white', background: 'linear-gradient(135deg,#0e1a2b,#153a74 60%,#0f3070)' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <h1>🎚️ Operator Console (Whisper)</h1>
        <p style={{ opacity: 0.9 }}>Share the code/QR. Set input language (or Auto). Choose target languages (csv). Start the mic.</p>

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

          <label>
            <span style={{ marginRight: 8 }}>Offer languages (csv):</span>
            <input
              value={langsCsv}
              onChange={(e) => setLangsCsv(e.target.value)}
              placeholder="es,vi,zh"
              style={{ padding: 8, borderRadius: 8, width: 240 }}
            />
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

        <h3 style={{ marginTop: 18 }}>Live Preview</h3>
        <div style={{ background: '#0b1220', color: 'white', padding: 12, borderRadius: 8, minHeight: 180, lineHeight: 1.6 }}>
          {log.map((l) => (
            <div key={l.ts + Math.random()} style={{ marginBottom: 8 }}>
              <div style={{ opacity: 0.6, fontSize: 12 }}>{new Date(l.ts).toLocaleTimeString()}</div>
              <div>🗣️ {l.en}</div>
              <div>🌍 {l.tx?.[firstLang]}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
