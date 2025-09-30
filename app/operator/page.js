'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// ---------- small helpers ----------
function makeCode(len = 4) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
const LANG_OPTIONS = [
  { v: 'AUTO', label: 'Auto-detect' },
  { v: 'en', label: 'English (United States)' },
  { v: 'es', label: 'Spanish' },
  { v: 'vi', label: 'Vietnamese' },
  { v: 'zh', label: 'Chinese' },
];

export default function OperatorPage() {
  // session + UI state
  const [code, setCode] = useState(makeCode());
  const [inputLang, setInputLang] = useState('en'); // default; 'AUTO' allowed
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Mic OFF');
  const [log, setLog] = useState([]);

  // media/recorder refs
  const mediaRef = useRef(null /** MediaStream | null */);
  const recRef = useRef(null /** MediaRecorder | null */);

  // keep a stable query string for API calls
  const baseQS = useMemo(
    () => new URLSearchParams({ code, inputLang }).toString(),
    [code, inputLang]
  );

  // ---------- session bootstrap + SSE ----------
  useEffect(() => {
    let es;
    (async () => {
      // announce/refresh session on the server
      try {
        const r = await fetch('/api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        if (!r.ok) throw new Error('session create failed');

        setLog((L) => [
          ...L,
          { t: Date.now(), text: `Session ${code} ready`, kind: 'sys' },
        ]);
      } catch (e) {
        setLog((L) => [
          ...L,
          { t: Date.now(), text: `Session error: ${e?.message || e}`, kind: 'err' },
        ]);
      }

      // connect to server-sent events to mirror final lines
      try {
        es = new EventSource(`/api/stream?code=${code}`);
        es.onmessage = (evt) => {
          try {
            const data = JSON.parse(evt.data);
            if (data?.text) {
              setLog((L) => [...L, { t: Date.now(), text: data.text, kind: 'final' }]);
            }
          } catch {}
        };
        es.onerror = () => {
          // leave a breadcrumb but don't spam
          setLog((L) => [...L, { t: Date.now(), text: 'SSE disconnected', kind: 'sys' }]);
        };
      } catch {}
    })();

    return () => {
      es?.close?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // ---------- MIC: start / stop with 5s finalized chunks ----------
  async function startMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true },
        video: false,
      });
      mediaRef.current = stream;

      const pickMime = () => {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
        if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
        if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) return 'audio/ogg;codecs=opus';
        return ''; // let browser pick
      };
      const mimeType = pickMime();

      const SEG_MS = 5000; // ship finalized files every 5s
      let segTimer;

      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recRef.current = rec;

      rec.onstart = () => {
        setStatus('Recording…');
        segTimer = window.setTimeout(() => {
          try {
            if (rec.state !== 'inactive') rec.stop();
          } catch {}
        }, SEG_MS);
      };

      rec.ondataavailable = async (e) => {
        // ondataavailable fires right after stop(); we now have a finalized file
        if (!e?.data || e.data.size < 6000) return;
        try {
          const ab = await e.data.arrayBuffer();
          const res = await fetch('/api/ingest?' + baseQS, {
            method: 'POST',
            headers: { 'Content-Type': e.data.type || 'application/octet-stream' },
            body: ab,
          });
          if (!res.ok) throw new Error('ingest ' + res.status);
          setStatus('Chunk processed');
        } catch (err) {
          setStatus('Upload error');
          setLog((L) => [
            ...L,
            { t: Date.now(), text: `Ingest error: ${err?.message || err}`, kind: 'err' },
          ]);
        }
      };

      rec.onstop = () => {
        window.clearTimeout(segTimer);
        // immediately roll to next segment while mic keeps running
        if (running && mediaRef.current) {
          try {
            rec.start();
            rec.onstart?.();
          } catch {}
        }
      };

      // prime first segment
      rec.start();
      setRunning(true);
      setStatus('Recording…');
    } catch (e) {
      setRunning(false);
      setStatus('Mic error');
      setLog((L) => [
        ...L,
        { t: Date.now(), text: `Mic error: ${e?.message || e}`, kind: 'err' },
      ]);
    }
  }

  function stopMic() {
    setRunning(false);
    setStatus('Mic OFF');
    try {
      const rec = recRef.current;
      if (rec && rec.state !== 'inactive') rec.stop();
    } catch {}
    try {
      const ms = mediaRef.current;
      if (ms) {
        ms.getTracks().forEach((t) => t.stop());
        mediaRef.current = null;
      }
    } catch {}
  }

  // this is the bug you hit earlier — keep it exactly like this:
  function toggleMic() {
    if (running) stopMic();
    else startMic();
  }

  // ---------- new session ----------
  async function newSession() {
    stopMic();
    const next = makeCode();
    setCode(next);
    setLog([]);
    setStatus('Mic OFF');
    try {
      const r = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: next, reset: true }),
      });
      if (!r.ok) throw new Error('session reset failed');
      setLog((L) => [...L, { t: Date.now(), text: `Session ${next} ready`, kind: 'sys' }]);
    } catch (e) {
      setLog((L) => [...L, { t: Date.now(), text: String(e), kind: 'err' }]);
    }
  }

  // ---------- UI ----------
  return (
    <div style={{ maxWidth: 980, margin: '32px auto', padding: '0 16px', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      <h1 style={{ margin: 0 }}>🖥️ Operator Console (Whisper)</h1>

      <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div><strong>Access Code:</strong> {code}</div>
        <a href={`/s/${code}`} target="_blank" rel="noreferrer">Open Listener</a>

        <label style={{ marginLeft: 12 }}>
          <span style={{ marginRight: 6 }}>Input language:</span>
          <select value={inputLang} onChange={(e) => setInputLang(e.target.value)}>
            {LANG_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>{o.label}</option>
            ))}
          </select>
        </label>

        <button
          onClick={toggleMic}
          style={{
            background: running ? '#10b981' : '#ef4444',
            color: 'white',
            border: 0,
            borderRadius: 6,
            padding: '6px 12px',
            fontWeight: 600
          }}
          aria-pressed={running}
        >
          {running ? 'Mic ON' : 'Mic OFF'}
        </button>

        <button onClick={newSession} style={{ padding: '6px 12px', borderRadius: 6 }}>
          End Session
        </button>

        <div style={{ opacity: 0.8 }}>Status: {status}</div>
      </div>

      <h3 style={{ marginTop: 18 }}>Live Preview (spoken text)</h3>
      <div
        style={{
          background: '#0f172a',
          color: 'white',
          borderRadius: 8,
          padding: 16,
          minHeight: 120,
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
        }}
      >
        {log.length === 0 ? (
          <div style={{ opacity: 0.7 }}>…waiting</div>
        ) : (
          log.map((row, i) => (
            <div key={i} style={{ opacity: row.kind === 'sys' ? 0.8 : 1 }}>
              <span style={{ color: '#9ca3af', marginRight: 8 }}>
                {new Date(row.t).toLocaleTimeString()}
              </span>
              <span>🗣️ </span>
              <span>{row.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
