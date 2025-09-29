'use client';

import { useEffect, useRef, useState } from 'react';

/** ===================== UI OPTIONS ===================== **/
const INPUT_LANGS = [
  { code: 'AUTO',  label: 'Auto-detect (Whisper)' },
  { code: 'en-US', label: 'English (United States)' },
  { code: 'en-GB', label: 'English (United Kingdom)' },
  { code: 'en-AU', label: 'English (Australia)' },
  { code: 'en-CA', label: 'English (Canada)' },
  { code: 'es-US', label: 'Spanish (United States)' },
  { code: 'es-ES', label: 'Spanish (Spain)' },
  { code: 'es-MX', label: 'Spanish (Mexico)' },
  { code: 'vi-VN', label: 'Vietnamese (Vietnam)' },
];
/** ====================================================== **/

/** ===== Utterance controls (tweak to taste) ===== */
const VAD_CHECK_MS     = 100;   // how often to check loudness
const PAUSE_MS         = 900;   // silence gap that ends an utterance
const MAX_UTTER_MS     = 8000;  // hard cap per utterance
const ENERGY_THRESHOLD = 0.012; // speaking threshold (0.006–0.02 typical)
/** ============================================== */

export default function OperatorPage() {
  const [code, setCode]           = useState<string | null>(null);
  const [inputLang, setInputLang] = useState('AUTO');
  const [langsCsv, setLangsCsv]   = useState('es,vi,zh');
  const [running, setRunning]     = useState(false);
  const [log, setLog]             = useState<any[]>([]);

  // media + recorder
  const mediaRef  = useRef<MediaStream | null>(null);
  const recRef    = useRef<MediaRecorder | null>(null);

  // WebAudio VAD bits
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const analyserRef  = useRef<AnalyserNode | null>(null);
  const vadTimerRef  = useRef<number | null>(null);

  const speakingRef      = useRef(false);
  const lastSpeechAtRef  = useRef<number>(0);
  const utterStartAtRef  = useRef<number>(0);

  // Accumulate tiny chunks; we’ll combine into one Blob per utterance
  const pendingChunksRef = useRef<BlobPart[]>([]);
  const pendingTypeRef   = useRef<string>('audio/webm');

  // listener link + QR
  const siteOrigin  = typeof window !== 'undefined' ? window.location.origin : 'https://onevoice.church';
  const listenerUrl = code ? `${siteOrigin}/s/${encodeURIComponent(code)}` : '#';
  const qrUrl       = code
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(listenerUrl)}`
    : '';

  /** ---------- load+persist simple prefs ---------- */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedCode = localStorage.getItem('ov:lastCode') || Math.random().toString(36).slice(2, 6).toUpperCase();
    setCode(savedCode);
    setInputLang(localStorage.getItem('ov:inputLang') || 'AUTO');
    setLangsCsv(localStorage.getItem('ov:langs') || 'es,vi,zh');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (code) localStorage.setItem('ov:lastCode', code);
    localStorage.setItem('ov:inputLang', inputLang);
    localStorage.setItem('ov:langs', langsCsv);
  }, [code, inputLang, langsCsv]);

  /** ---------- Live preview via SSE ---------- */
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

  /** ---------- Session controls ---------- */
  async function startSession() {
    const res = await fetch('/api/session', { method: 'POST' });
    const j   = await res.json();
    if (j.code) setCode(j.code);
  }

  async function endSession() {
    if (!code) return;
    await fetch(`/api/session?code=${encodeURIComponent(code)}`, { method: 'DELETE' });
    stopMic();
    setLog([]);
  }

  /** ---------- Mic + VAD + utterance flushing ---------- */
  async function startMic() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true },
      video: false
    });
    mediaRef.current = stream;

    // WebAudio for loudness/VAD
    audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    const src = audioCtxRef.current.createMediaStreamSource(stream);
    analyserRef.current = audioCtxRef.current.createAnalyser();
    analyserRef.current.fftSize = 2048;
    src.connect(analyserRef.current);

    speakingRef.current     = false;
    lastSpeechAtRef.current = performance.now();
    utterStartAtRef.current = performance.now();

    // MediaRecorder – pick a supported mimeType (Chrome: webm/opus; Safari: often mp4)
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/mpeg',
      ''
    ];
    const chosen = candidates.find(t => (tryIsTypeSupported(t))) || '';
    const rec = chosen ? new MediaRecorder(stream, { mimeType: chosen }) : new MediaRecorder(stream);
    recRef.current = rec;
    pendingTypeRef.current = rec.mimeType || 'audio/webm';

    // collect tiny chunks (we’ll flush later)
    rec.ondataavailable = (e) => {
      if (!e.data || e.data.size < 1024) return;
      pendingChunksRef.current.push(e.data);
    };
    rec.start(250); // small internal slices; we decide when to send

    // VAD loop
    const buffer = new Uint8Array(analyserRef.current.fftSize);
    vadTimerRef.current = window.setInterval(async () => {
      analyserRef.current!.getByteTimeDomainData(buffer);
      // compute RMS
      let s = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = (buffer[i] - 128) / 128;
        s += v * v;
      }
      const rms = Math.sqrt(s / buffer.length);

      const now = performance.now();
      const speaking = rms > ENERGY_THRESHOLD;

      if (speaking) {
        speakingRef.current     = true;
        lastSpeechAtRef.current = now;
        if (now - utterStartAtRef.current > MAX_UTTER_MS) {
          utterStartAtRef.current = now; // reset window if they keep talking forever
        }
      }

      const longEnough = now - utterStartAtRef.current >= MAX_UTTER_MS;
      const paused     = speakingRef.current && (now - lastSpeechAtRef.current >= PAUSE_MS);

      if (paused || longEnough) {
        await flushUtterance();
        speakingRef.current     = false;
        utterStartAtRef.current = performance.now();
      }
    }, VAD_CHECK_MS);

    setRunning(true);
  }

  function stopMic() {
    try { recRef.current?.stop(); } catch {}
    mediaRef.current?.getTracks().forEach(t => t.stop());
    if (vadTimerRef.current) clearInterval(vadTimerRef.current);
    try { audioCtxRef.current?.close(); } catch {}
    pendingChunksRef.current = [];
    setRunning(false);
  }

  async function flushUtterance() {
    const parts = pendingChunksRef.current;
    if (!parts.length) return;

    const type = pendingTypeRef.current || 'audio/webm';
    const blob = new Blob(parts, { type });
    pendingChunksRef.current = []; // clear buffer

    // ignore microscopic utterances (avoid 400s & wasted calls)
    if (blob.size < 2500) return;

    try {
      const qs = new URLSearchParams({
        code: code || '',
        inputLang,
        langs: (langsCsv || 'es').replace(/\s+/g, '')
      });

      const ab = await blob.arrayBuffer();
      await fetch('/api/ingest?' + qs.toString(), {
        method: 'POST',
        headers: { 'Content-Type': type },
        body: ab
      });
    } catch (err) {
      console.error('flushUtterance error', err);
    }
  }

  /** ---------- helpers ---------- */
  function tryIsTypeSupported(t: string) {
    try { return t && MediaRecorder.isTypeSupported(t); } catch { return false; }
  }

  /** ---------- UI ---------- */
  return (
    <main style={{ minHeight: '100vh', padding: 24, color: 'white',
      background: 'linear-gradient(135deg,#0e1a2b,#153a74 60%,#0f3070)' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <h1>🎚️ Operator Console (Whisper)</h1>
        <p style={{ opacity: 0.9 }}>
          Share the code/QR. Set input language (or Auto). Choose target languages (csv). Start the mic.
        </p>

        {code && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center' }}>
            <div>
              <div style={{ marginBottom: 6 }}>Access Code</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <code style={{ background: 'rgba(255,255,255,0.15)', padding: '6px 10px',
                  borderRadius: 8, fontSize: 20 }}>{code}</code>
                <button onClick={startSession}
                  style={{ padding: '8px 12px', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
                  New Session
                </button>
                <a href={listenerUrl} target="_blank" rel="noreferrer"
                   style={{ color: 'white', textDecoration: 'underline' }}>
                  Open Listener
                </a>
              </div>
            </div>
            <div style={{ justifySelf: 'end' }}>
              {qrUrl && <img src={qrUrl} alt="QR" width={120} height={120}
                             style={{ background: 'white', borderRadius: 8 }} />}
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
            <button onClick={startMic}
              style={{ padding: '8px 12px', borderRadius: 8, border: 'none', fontWeight: 700, cursor: 'pointer' }}>
              🎙️ Mic ON
            </button>
          ) : (
            <button onClick={stopMic}
              style={{ padding: '8px 12px', borderRadius: 8, border: 'none',
                background: '#ff5555', color: 'white', fontWeight: 700, cursor: 'pointer' }}>
              ⏹️ Mic OFF
            </button>
          )}

          <button onClick={endSession}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.5)', cursor: 'pointer' }}>
            End Session
          </button>
        </div>

        <h3 style={{ marginTop: 18 }}>Live Preview</h3>
        <div style={{ background: '#0b1220', color: 'white', padding: 12, borderRadius: 8,
          minHeight: 180, lineHeight: 1.6 }}>
          {log.map((l) => {
            const first = (langsCsv || 'es').split(',')[0].trim();
            return (
              <div key={l.ts + Math.random()} style={{ marginBottom: 8 }}>
                <div style={{ opacity: 0.6, fontSize: 12 }}>{new Date(l.ts).toLocaleTimeString()}</div>
                <div>🗣️ {l.en}</div>
                <div>🌍 {l.tx?.[first]}</div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
