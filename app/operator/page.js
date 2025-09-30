'use client';

import { useEffect, useRef, useState } from 'react';

/** ====== Mic/Chunk tuning ====== */
const SEG_MS = 5000;         // record 5s segments (forces finalized files)
const MIN_SEND_B = 6000;     // ignore tiny blobs to avoid 400s
/** ============================= */

const INPUT_LANGS = [
  { code: 'AUTO', label: 'Auto-detect (Whisper)' },
  { code: 'en-US', label: 'English (United States)' },
  { code: 'en-GB', label: 'English (United Kingdom)' },
  { code: 'es-ES', label: 'Spanish (Spain)' },
  { code: 'es-MX', label: 'Spanish (Mexico)' },
  { code: 'vi-VN', label: 'Vietnamese (Vietnam)' },
  { code: 'zh',   label: 'Chinese' },
];

export default function Operator() {
  const [code, setCode] = useState<string | null>(null);
  const [inputLang, setInputLang] = useState('AUTO');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<any[]>([]);

  const mediaRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const segTimerRef = useRef<number | null>(null);

  // derive listener URL + QR
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://onevoice.church';
  const listenerUrl = code ? `${origin}/s/${encodeURIComponent(code)}` : '#';
  const qrUrl = code
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(listenerUrl)}`
    : '';

  /** Load/persist prefs */
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

  /** Live preview via SSE */
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

  /** ---------- MIC START (fixed) ---------- */
  async function startMic() {
    try {
      // 1) Ask for mic
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true },
        video: false,
      });
      mediaRef.current = stream;
      setRunning(true);

      // 2) Force a *safe* MIME (fixes “no audio / invalid format” on Chrome)
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      // Small helper to start one 5s segment
      const startRecorder = () => {
        const rec = new MediaRecorder(stream, { mimeType });
        recRef.current = rec;

        rec.ondataavailable = async (e: BlobEvent) => {
          if (!e.data) return;
          if (e.data.size < MIN_SEND_B) {
            console.debug('[ingest] skip tiny blob', e.data.size);
            return;
          }
          try {
            const qs = new URLSearchParams({
              code: code || '',
              inputLang,                 // 'AUTO' or specific locale
              langs: 'es',               // harmless; operator preview ignores translations
            });
            const ab = await e.data.arrayBuffer();
            console.debug('[ingest] sending blob', {
              size: e.data.size,
              type: e.data.type,
              qs: qs.toString(),
            });
            await fetch('/api/ingest?' + qs.toString(), {
              method: 'POST',
              headers: { 'Content-Type': e.data.type || 'audio/webm' },
              body: ab,
            });
          } catch (err) {
            console.error('ingest send error', err);
          }
        };

        rec.onstart = () => {
          // Stop after SEG_MS so the browser *finalizes* the container
          if (segTimerRef.current) window.clearTimeout(segTimerRef.current);
          segTimerRef.current = window.setTimeout(() => {
            try {
              if (rec.state !== 'inactive') rec.stop();
            } catch {}
          }, SEG_MS) as unknown as number;
        };

        rec.onstop = () => {
          if (segTimerRef.current) {
            window.clearTimeout(segTimerRef.current);
            segTimerRef.current = null;
          }
          // Immediately start the next segment while the mic stays open
          if (running && mediaRef.current) startRecorder();
        };

        rec.start(); // no timeslice → we'll call stop() ourselves
      };

      startRecorder();
    } catch (err: any) {
      // Most common: permission denied or blocked
      console.error('startMic failed', err?.name || err);
      alert(
        'Microphone could not start.\n\nIf the browser asked for permission, click "Allow".\n' +
        'If it is blocked, click the mic icon in the address bar and choose "Always allow".'
      );
      stopMic();
    }
  }
  /** ---------- MIC STOP ---------- */
  function stopMic() {
    setRunning(false);
    try {
      if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
    } catch {}
    if (mediaRef.current) {
      mediaRef.current.getTracks().forEach((t) => t.stop());
      mediaRef.current = null;
    }
    if (segTimerRef.current) {
      window.clearTimeout(segTimerRef.current);
      segTimerRef.current = null;
    }
  }

  return (
    <main style={{ minHeight: '100vh', padding: 24, color: 'white', background: 'linear-gradient(135deg,#0e1a2b,#153a74 60%,#0f3070)' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
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

        <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
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
          {log.map((l) => (
            <div key={l.ts + Math.random()} style={{ marginBottom: 10 }}>
              <div style={{ opacity: 0.6, fontSize: 12 }}>{new Date(l.ts).toLocaleTimeString()}</div>
              <div>🗣️ {l.en}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
