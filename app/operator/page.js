'use client';

import { useEffect, useRef, useState } from 'react';

const SEG_MS = 5000; // finalize + restart every 5s (prevents 400s)

export default function OperatorPage() {
  const [code, setCode] = useState(null);
  const [inputLang, setInputLang] = useState('AUTO'); // 'AUTO' or like 'en-US'
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [log, setLog] = useState([]);

  const mediaRef = useRef(null);       // MediaStream
  const recRef = useRef(null);         // MediaRecorder
  const esRef = useRef(null);          // EventSource
  const segTimerRef = useRef(null);    // timer id

  // Create session on mount
  useEffect(() => {
    (async () => {
      const r = await fetch('/api/session', { method: 'POST' });
      const j = await r.json();
      setCode(j.code);
      appendLine({ ts: Date.now(), who: 'sys', text: `Session ${j.code} ready` });
      reconnectSSE(j.code);
    })();
    return () => {
      try { esRef.current && esRef.current.close(); } catch {}
    };
  }, []);

  function appendLine(line) {
    setLog((prev) => [...prev, line].slice(-200));
  }

  function reconnectSSE(theCode) {
    try {
      esRef.current && esRef.current.close();
    } catch {}
    const es = new EventSource(`/api/stream?code=${encodeURIComponent(theCode)}`);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        appendLine(data);
      } catch {}
    };
    es.addEventListener('end', () => {
      appendLine({ ts: Date.now(), who: 'sys', text: 'Session ended' });
    });
    es.onerror = () => {
      // auto-retry
      try { es.close(); } catch {}
      setTimeout(() => reconnectSSE(theCode), 1500);
    };
    esRef.current = es;
  }

  async function startMic() {
    if (running) return;
    setStatus('Mic starting…');

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true },
      video: false,
    });
    mediaRef.current = stream;
    setRunning(true);

    // Pick a very compatible mimeType
    const mimeType =
      MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
      MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
      MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' :
      '';

    const startRecorder = () => {
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      rec.ondataavailable = async (e) => {
        if (!e.data || e.data.size < 6000) return;
        try {
          const qs = new URLSearchParams({
            code: code || '',
            inputLang: inputLang || 'AUTO',
          });
          const ab = await e.data.arrayBuffer();
          const r = await fetch('/api/ingest?' + qs.toString(), {
            method: 'POST',
            headers: { 'Content-Type': e.data.type || 'audio/webm' },
            body: ab,
          });
          const j = await r.json().catch(()=>({}));
          setStatus(`Chunk processed`);
        } catch (err) {
          console.error('ingest send error', err);
          setStatus('Chunk error');
        }
      };
      rec.onstart = () => {
        segTimerRef.current = window.setTimeout(() => {
          try { rec.state !== 'inactive' && rec.stop(); } catch {}
        }, SEG_MS);
      };
      rec.onstop = () => {
        window.clearTimeout(segTimerRef.current);
        if (running && mediaRef.current) startRecorder();
      };
      rec.start();
      recRef.current = rec;
    };

    startRecorder();
    setStatus('Mic ON');
  }

  function stopMic() {
    setRunning(false);
    setStatus('Mic OFF');
    try { recRef.current && recRef.current.state !== 'inactive' && recRef.current.stop(); } catch {}
    if (mediaRef.current) {
      mediaRef.current.getTracks().forEach(t => t.stop());
      mediaRef.current = null;
    }
    window.clearTimeout(segTimerRef.current);
  }

  async function endSession() {
    stopMic();
    try {
      await fetch(`/api/session?code=${encodeURIComponent(code || '')}`, { method: 'DELETE' });
    } catch {}
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>🎙️ Operator Console (Whisper)</h1>

      <div style={{ marginTop: 12, marginBottom: 12 }}>
        <strong>Access Code:</strong> {code || '—'}{' '}
        <button onClick={() => window.open(`/s/${code}`, '_blank')}>Open Listener</button>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <label>Input language:&nbsp;
          <select value={inputLang} onChange={e => setInputLang(e.target.value)}>
            <option value="AUTO">Auto-detect</option>
            <option value="en-US">English (United States)</option>
            <option value="es">Spanish</option>
            <option value="vi">Vietnamese</option>
            <option value="zh">Chinese</option>
            {/* add more here — UI only */}
          </select>
        </label>
        <button onClick={running ? stopMic : startMic} style={{ background: running ? '#c33' : '#2b6' , color:'#fff', padding:'6px 10px', borderRadius:6 }}>
          {running ? 'Mic OFF' : 'Mic ON'}
        </button>
        <button onClick={endSession}>End Session</button>
        <span style={{ opacity: 0.7 }}>Status: {status || '—'}</span>
      </div>

      <h3>Live Preview (spoken text)</h3>
      <div style={{
        background:'#0f1a24',
        color:'#e8f4ff',
        padding:16,
        borderRadius:8,
        maxWidth:900,
      }}>
        {log.map((l, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <span style={{ opacity: 0.6, fontSize: 12 }}>
              {new Date(l.ts).toLocaleTimeString()} —&nbsp;
            </span>
            <span>🗣️ {l.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
