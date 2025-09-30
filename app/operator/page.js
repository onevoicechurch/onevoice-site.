'use client';

import { useEffect, useRef, useState } from 'react';

const SEG_MS = 5000; // finalize every 5s

export default function Operator() {
  const [code, setCode] = useState(null);
  const [inputLang, setInputLang] = useState('AUTO'); // AUTO or locale like "en-US"
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);            // live preview lines
  const [status, setStatus] = useState('Idle');  // mic / network status line

  const mediaRef = useRef(/** @type {MediaStream|null} */(null));
  const recRef   = useRef(/** @type {MediaRecorder|null} */(null));
  const segTimer = useRef(/** @type {number|undefined} */(undefined));

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://onevoice.church';
  const listenerUrl = code ? `${origin}/s/${encodeURIComponent(code)}` : '#';
  const qrUrl = code
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(listenerUrl)}`
    : '';

  // boot: create/restore session code
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('ov:lastCode');
    if (saved) setCode(saved);
    else newSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // persist code + inputLang
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
        const line = JSON.parse(e.data);
        setLog((prev) => [...prev, line].slice(-200));
      } catch {}
    };
    es.addEventListener('end', () => es.close());
    return () => es.close();
  }, [code]);

  async function newSession() {
    try {
      const r = await fetch('/api/session', { method: 'POST' });
      const j = await r.json();
      if (j.code) setCode(j.code);
      setLog([]);
    } catch (e) {
      setStatus('Failed to create session');
    }
  }

  async function endSession() {
    if (!code) return;
    try {
      await fetch(`/api/session?code=${encodeURIComponent(code)}`, { method: 'DELETE' });
    } catch {}
    stopMic();
    setLog([]);
  }

  // ---- MIC CONTROL ----

  function pickMimeType() {
    // Prefer webm/opus on Chrome; fall back to ogg/opus where needed.
    if (typeof MediaRecorder === 'undefined') return '';
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
    if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
    if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) return 'audio/ogg;codecs=opus';
    return ''; // let the browser choose
  }

  async function startMic() {
    if (!code) {
      await newSession();
      if (!code) return;
    }
    setStatus('Requesting mic permission…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      mediaRef.current = stream;

      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recRef.current = rec;

      rec.ondataavailable = async (e) => {
        try {
          if (!e.data || e.data.size < 5000) return; // ignore tiny blobs
          setStatus('Uploading chunk…');
          const ab = await e.data.arrayBuffer();
          const qs = new URLSearchParams({
            code: code || '',
            inputLang: inputLang || 'AUTO',
          });
          const res = await fetch('/api/ingest?' + qs.toString(), {
            method: 'POST',
            headers: { 'Content-Type': e.data.type || 'audio/webm' },
            body: ab,
          });
          if (!res.ok) {
            const msg = (await res.text()).slice(0, 200);
            setStatus(`Ingest error ${res.status}: ${msg}`);
          } else {
            setStatus('Chunk processed');
          }
        } catch (err) {
          setStatus('Upload failed');
          // eslint-disable-next-line no-console
          console.error('ingest send error', err);
        }
      };

      rec.onstart = () => {
        setStatus('Recording…');
        segTimer.current = window.setTimeout(() => {
          try { rec.state !== 'inactive' && rec.stop(); } catch {}
        }, SEG_MS);
      };

      rec.onstop = () => {
        if (segTimer.current) window.clearTimeout(segTimer.current);
        if (running && mediaRef.current) {
          // Immediately start a new segment while mic stays open
          try { rec.start(); } catch {}
          segTimer.current = window.setTimeout(() => {
            try { rec.state !== 'inactive' && rec.stop(); } catch {}
          }, SEG_MS);
        } else {
          setStatus('Stopped');
        }
      };

      // kick off first segment
      rec.start();
      setRunning(true);
      setStatus(`Recording (${mimeType || 'default codec'})`);
    } catch (err) {
      setStatus('Mic permission denied or unavailable');
      // eslint-disable-next-line no-console
      console.error('mic error', err);
      stopMic();
    }
  }

  function stopMic() {
    setRunning(false);
    try { recRef.current && recRef.current.state !== 'inactive' && recRef.current.stop(); } catch {}
    recRef.current = null;
    if (segTimer.current) window.clearTimeout(segTimer.current);
    if (mediaRef.current) {
      mediaRef.current.getTracks().forEach((t) => t.stop());
      mediaRef.current = null;
    }
    setStatus('Idle');
  }

  const InputLangs = [
    { code: 'AUTO',  label: 'Auto-detect (Whisper)' },
    { code: 'en-US', label: 'English (United States)' },
    { code: 'es-ES', label: 'Spanish (Spain)' },
    { code: 'es-MX', label: 'Spanish (Mexico)' },
    { code: 'vi-VN', label: 'Vietnamese' },
    { code: 'pt-BR', label: 'Portuguese (Brazil)' },
    { code: 'fr-FR', label: 'French' },
    { code: 'de-DE', label: 'German' },
    { code: 'zh',    label: 'Chinese' },
  ];

  return (
    <main style={{ minHeight: '100vh', padding: 24, color: 'white',
      background: 'linear-gradient(135deg,#0e1a2b,#153a74 60%,#0f3070)' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <h1>🎛️ Operator Console (Whisper)</h1>
        <p style={{ opacity: 0.9 }}>
          Share the code/QR. Pick input language (or Auto). Start the mic.
        </p>

        {/* Code / Actions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center' }}>
          <div>
            <div style={{ marginBottom: 6 }}>Access Code</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{ background: 'rgba(255,255,255,0.15)', padding: '6px 10px', borderRadius: 8, fontSize: 20 }}>
                {code || '— — — —'}
              </code>
              <button onClick={newSession} style={{ padding: '8px 12px', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
                New Session
              </button>
              {code && (
                <a href={listenerUrl} target="_blank" rel="noreferrer" style={{ color: 'white', textDecoration: 'underline' }}>
                  Open Listener
                </a>
              )}
            </div>
          </div>
          <div style={{ justifySelf: 'end' }}>
            {qrUrl && <img src={qrUrl} alt="QR" width={120} height={120} style={{ background: 'white', borderRadius: 8 }} />}
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <label>
            <span style={{ marginRight: 8 }}>Input language:</span>
            <select value={inputLang} onChange={(e) => setInputLang(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
              {InputLangs.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>

          {!running ? (
            <button onClick={startMic} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', fontWeight: 700, cursor: 'pointer', background:'#1fb36b', color:'#04151f' }}>
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

          <span style={{ opacity: 0.85 }}>Status: <strong>{status}</strong></span>
        </div>

        {/* Live Preview */}
        <h3 style={{ marginTop: 18 }}>Live Preview (spoken text)</h3>
        <div style={{ background: '#0b1220', color: 'white', padding: 12, borderRadius: 8, minHeight: 220, lineHeight: 1.6 }}>
          {log.map((l, i) => (
            <div key={(l.ts || i) + ':' + i} style={{ marginBottom: 8 }}>
              <div style={{ opacity: 0.6, fontSize: 12 }}>{new Date(l.ts).toLocaleTimeString()}</div>
              <div>🗣️ {l.en || l.text || ''}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
