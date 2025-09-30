'use client';

import { useEffect, useRef, useState } from 'react';

// === constants ===
const SEG_MS = 5000; // finalize a chunk every 5s (prevents 400 "invalid container" errors)

// === helpers ===
function newCode() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

export default function OperatorPage() {
  // state (PLAIN JS — no TypeScript generics!)
  const [code, setCode] = useState(null);          // session code
  const [inputLang, setInputLang] = useState('AUTO');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [log, setLog] = useState([]);              // [{time, text}]

  // refs
  const mediaRef = useRef(null);        // MediaStream
  const recRef = useRef(null);          // MediaRecorder
  const segTimerRef = useRef(0);        // segment timer id

  // --- mic control (segmenting recorder) ---
  async function startMic() {
    if (running) return;
    setStatus('Requesting mic…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true },
        video: false,
      });
      mediaRef.current = stream;

      const mimeType =
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
        MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
        MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' :
        '';

      const startRecorder = () => {
        const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recRef.current = rec;

        rec.ondataavailable = async (e) => {
          // only after stop() (final container)
          if (!e.data || e.data.size < 6000) return;
          try {
            const qs = new URLSearchParams({
              code: code || '',
              inputLang,
            });
            const ab = await e.data.arrayBuffer();
            await fetch('/api/ingest?' + qs.toString(), {
              method: 'POST',
              headers: { 'Content-Type': e.data.type || 'audio/webm' },
              body: ab,
            });
            setStatus('Chunk processed');
          } catch (err) {
            console.error('ingest error', err);
            setStatus('Ingest error');
          }
        };

        rec.onstart = () => {
          // stop after SEG_MS so we finalize and immediately restart
          segTimerRef.current = window.setTimeout(() => {
            try {
              if (rec.state !== 'inactive') rec.stop();
            } catch {}
          }, SEG_MS);
        };

        rec.onstop = () => {
          window.clearTimeout(segTimerRef.current);
          // chain next segment while mic is still active
          if (running && mediaRef.current) startRecorder();
        };

        rec.start(); // we’ll call stop() ourselves via the timer
      };

      setRunning(true);
      setStatus('Mic on');
      startRecorder();
    } catch (err) {
      console.error('mic error', err);
      setStatus('Mic error');
      setRunning(false);
    }
  }

  function stopMic() {
    setRunning(false);
    window.clearTimeout(segTimerRef.current);
    try {
      const r = recRef.current;
      if (r && r.state !== 'inactive') r.stop();
    } catch {}
    recRef.current = null;

    if (mediaRef.current) {
      try {
        mediaRef.current.getTracks().forEach(t => t.stop());
      } catch {}
      mediaRef.current = null;
    }
    setStatus('Mic off');
  }

  // end session (resets state)
  function endSession() {
    stopMic();
    setCode(null);
    setLog(l => [...l, { time: Date.now(), text: 'Session ended' }]);
  }

  // clean up on unmount
  useEffect(() => {
    return () => stopMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // new session
  function newSession() {
    const c = newCode();
    setCode(c);
    setLog([{ time: Date.now(), text: `Session ${c} ready` }]);
    setStatus('Ready');
  }

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      <h2 style={{ marginTop: 0 }}>🎙️ Operator Console (Whisper)</h2>

      <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div><strong>Access Code:</strong> {code || '----'}</div>
        <button onClick={newSession} disabled={running}>New Session</button>
        {code && (
          <a href={`/s/${code}`} target="_blank" rel="noreferrer">Open Listener</a>
        )}
      </div>

      <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label>Input language:</label>
        <select value={inputLang} onChange={e => setInputLang(e.target.value)} disabled={running}>
          <option value="AUTO">Auto-detect</option>
          <option value="en">English (United States)</option>
          <option value="es">Spanish</option>
          <option value="vi">Vietnamese</option>
          <option value="zh">Chinese</option>
        </select>

        {!running ? (
          <button onClick={startMic} disabled={!code}>🎤 Mic ON</button>
        ) : (
          <button onClick={stopMic} style={{ background: '#e33', color: '#fff' }}>🛑 Mic OFF</button>
        )}

        <button onClick={endSession} disabled={!code}>End Session</button>
        <span style={{ opacity: 0.75 }}>Status: {status}</span>
      </div>

      <h3 style={{ margin: '8px 0' }}>Live Preview (spoken text)</h3>
      <div
        style={{
          background: '#0b1c2c',
          color: 'white',
          padding: 14,
          borderRadius: 8,
          minHeight: 160,
          boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
          maxWidth: 900,
        }}
      >
        {log.length === 0 ? (
          <div style={{ opacity: 0.6 }}>No text yet…</div>
        ) : (
          log.map((entry, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <span role="img" aria-label="speech">🗣️</span>{' '}
              {new Date(entry.time).toLocaleTimeString()} — {entry.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
