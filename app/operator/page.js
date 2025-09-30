'use client';

import { useEffect, useRef, useState } from 'react';

const SEG_MS = 5000;         // record 5s finalized segments
const MIN_SEND_B = 6000;     // drop tiny blobs

const INPUT_LANGS = [
  { code: 'AUTO', label: 'Auto-detect (Whisper)' },
  { code: 'en-US', label: 'English (United States)' },
  { code: 'en-GB', label: 'English (United Kingdom)' },
  { code: 'es-US', label: 'Spanish (United States)' },
  { code: 'es-ES', label: 'Spanish (Spain)' },
  { code: 'es-MX', label: 'Spanish (Mexico)' },
  { code: 'vi-VN', label: 'Vietnamese (Vietnam)' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)' },
  { code: 'fr-FR', label: 'French (France)' },
  { code: 'de-DE', label: 'German (Germany)' },
  { code: 'zh-CN', label: 'Chinese (Mandarin)' },
];

export default function Operator() {
  const [code, setCode] = useState('');
  const [inputLang, setInputLang] = useState('en-US');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);

  const mediaRef = useRef(null);
  const recRef = useRef(null);
  const segTimerRef = useRef(0);
  const esRef = useRef(null);

  // bootstrap code & prefs
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const last = localStorage.getItem('ov:lastCode') || Math.random().toString(36).slice(2, 6).toUpperCase();
    setCode(last);
    setInputLang(localStorage.getItem('ov:inputLang') || 'en-US');
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (code) localStorage.setItem('ov:lastCode', code);
    localStorage.setItem('ov:inputLang', inputLang);
  }, [code, inputLang]);

  // LIVE PREVIEW via SSE (spoken text only)
  useEffect(() => {
    if (!code) return;
    const es = new EventSource(`/api/stream?code=${encodeURIComponent(code)}`);
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const line = JSON.parse(e.data); // { ts, en }
        if (!line?.en) return;
        setLog((prev) => [...prev, { ts: line.ts, text: line.en }].slice(-200));
      } catch {}
    };
    es.addEventListener('end', () => es.close());
    return () => { try { es.close(); } catch {} };
  }, [code]);

  async function newSession() {
    const r = await fetch('/api/session', { method: 'POST' });
    const j = await r.json();
    if (j.code) {
      setCode(j.code);
      setLog([]);
    }
  }

  async function endSession() {
    if (!code) return;
    try { await fetch(`/api/session?code=${encodeURIComponent(code)}`, { method: 'DELETE' }); } catch {}
    stopMic();
    setLog([]);
  }

  async function startMic() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true },
      video: false,
    });
    mediaRef.current = stream;

    // pick a very compatible mimeType
    const mimeType =
      (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') && 'audio/webm;codecs=opus') ||
      (MediaRecorder.isTypeSupported('audio/webm') && 'audio/webm') ||
      (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') && 'audio/ogg;codecs=opus') ||
      '';

    let recorder;

    const startRecorder = () => {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recRef.current = recorder;

      recorder.ondataavailable = async (e) => {
        if (!e.data || e.data.size < MIN_SEND_B) return;
        try {
          const qs = new URLSearchParams({
            code: code || '',
            inputLang: inputLang || 'AUTO',
            // send a harmless langs=es so /api/ingest stays happy even if you don't use tx
            langs: 'es',
          });
          const ab = await e.data.arrayBuffer();
          await fetch('/api/ingest?' + qs.toString(), {
            method: 'POST',
            headers: { 'Content-Type': e.data.type || 'audio/webm' },
            body: ab,
          });
        } catch (err) {
          console.error('ingest send error', err);
        }
      };

      recorder.onstart = () => {
        segTimerRef.current = window.setTimeout(() => {
          try { recorder.state !== 'inactive' && recorder.stop(); } catch {}
        }, SEG_MS);
      };

      recorder.onstop = () => {
        window.clearTimeout(segTimerRef.current);
        if (running && mediaRef.current) startRecorder(); // immediately roll into next segment
      };

      recorder.start(); // no timeslice; we stop manually to finalize the container
    };

    startRecorder();
    setRunning(true);
  }

  function stopMic() {
    setRunning(false);
    try { recRef.current && recRef.current.state !== 'inactive' && recRef.current.stop(); } catch {}
    window.clearTimeout(segTimerRef.current);
    if (mediaRef.current) {
      mediaRef.current.getTracks().forEach((t) => t.stop());
      mediaRef.current = null;
    }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const listenerUrl = code ? `${origin}/s/${encodeURIComponent(code)}` : '#';
  const qrUrl = code
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(listenerUrl)}`
    : '';

  return (
    <main style={{ minHeight: '100vh', padding: 24, color: 'white', background: 'linear-gradient(135deg,#0e1a2b,#153a74 60%,#0f3070)' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <h1>🎚️ Operator Console (Whisper)</h1>
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
              🟥 Mic OFF
            </button>
          )}

          <button onClick={endSession} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.5)', cursor: 'pointer' }}>
            End Session
          </button>
        </div>

        <h3 style={{ marginTop: 18 }}>Live Preview (spoken text)</h3>
        <div style={{ background: '#0b1220', color: 'white', padding: 16, borderRadius: 10, minHeight: 220, lineHeight: 1.55 }}>
          {log.map((l) => (
            <div key={l.ts} style={{ marginBottom: 10 }}>
              <div style={{ opacity: 0.6, fontSize: 12 }}>{new Date(l.ts).toLocaleTimeString()}</div>
              <div>🗣️ {l.text}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
