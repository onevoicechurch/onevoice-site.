'use client';
import { useEffect, useRef, useState } from 'react';

const SEG_MS = 3000; // short segments so it feels continuous

export default function OperatorPage() {
  const [code, setCode] = useState(() => Math.random().toString(36).slice(2, 6).toUpperCase());
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [inputLang, setInputLang] = useState('AUTO'); // 'AUTO' or BCP-47
  const [log, setLog] = useState([]);
  const cursorRef = useRef(0);

  const mediaRef = useRef(null);
  const recRef = useRef(null);
  const segTimerRef = useRef(null);

  // create session on mount or code change
  useEffect(() => {
    setLog([]);
    cursorRef.current = 0;
    fetch('/api/session', { method: 'POST', body: JSON.stringify({ code }), headers: { 'Content-Type': 'application/json' } })
      .then(() => setStatus(`Session ${code} ready`))
      .catch(() => setStatus('Session error'));
    return () => { fetch(`/api/session?code=${code}`, { method: 'DELETE' }).catch(()=>{}); };
  }, [code]);

  // poll for new lines
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/stream?code=${code}&since=${cursorRef.current}`, { cache: 'no-store' });
        const j = await r.json();
        if (j?.items?.length) {
          setLog(prev => [...prev, ...j.items]);
          cursorRef.current = j.next ?? cursorRef.current;
        }
      } catch {}
    }, 800);
    return () => clearInterval(id);
  }, [code]);

  function pickMime() {
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
    if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
    if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) return 'audio/ogg;codecs=opus';
    return '';
  }

  const startMic = async () => {
    if (running) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      mediaRef.current = stream;
      setRunning(true);

      const mime = pickMime();
      const makeRecorder = () => {
        const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);

        rec.ondataavailable = async (e) => {
          // will fire with a finalized blob ONLY after stop()
          if (!e.data || e.data.size < 4000) return; // tiny chunks are usually header-only
          try {
            setStatus('Uploading…');
            const qs = new URLSearchParams({
              code,
              inputLang: inputLang === 'AUTO' ? '' : inputLang,
            });
            const ab = await e.data.arrayBuffer();
            await fetch('/api/ingest?' + qs.toString(), {
              method: 'POST',
              headers: { 'Content-Type': e.data.type || 'application/octet-stream' },
              body: ab,
            });
            setStatus('Chunk processed');
          } catch (err) {
            console.error('ingest send error', err);
            setStatus('Upload error');
          }
        };

        rec.onstart = () => {
          segTimerRef.current = window.setTimeout(() => {
            try { rec.state !== 'inactive' && rec.stop(); } catch {}
          }, SEG_MS);
        };

        rec.onstop = () => {
          window.clearTimeout(segTimerRef.current);
          if (running && mediaRef.current) {
            // immediately start next segment while mic stays open
            makeRecorder();
          }
        };

        rec.start(); // no timeslice — we manually stop to finalize the container
        recRef.current = rec;
      };

      makeRecorder();
    } catch (e) {
      console.error('getUserMedia failed', e);
      setStatus('Mic permission/selection error');
    }
  };

  const stopMic = () => {
    setRunning(false);
    try { recRef.current && recRef.current.state !== 'inactive' && recRef.current.stop(); } catch {}
    if (mediaRef.current) {
      mediaRef.current.getTracks().forEach(t => t.stop());
      mediaRef.current = null;
    }
  };

  return (
    <div style={{ maxWidth: 980, margin: '40px auto', padding: 12 }}>
      <h1>🖥️ Operator Console (Whisper)</h1>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>Access Code: <b>{code}</b></div>
        <button onClick={() => setCode(Math.random().toString(36).slice(2, 6).toUpperCase())}>New Session</button>
        <a href={`/s/${code}`} target="_blank" rel="noreferrer">Open Listener</a>
        <div>
          Input language:&nbsp;
          <select value={inputLang} onChange={e => setInputLang(e.target.value)}>
            <option value="AUTO">Auto-detect</option>
            <option value="en">English (United States)</option>
            <option value="es">Spanish</option>
            <option value="vi">Vietnamese</option>
            <option value="zh">Chinese</option>
            {/* add more as needed */}
          </select>
        </div>
        {!running
          ? <button style={{ background:'#16a34a', color:'#fff' }} onClick={startMic}>Mic ON</button>
          : <button style={{ background:'#ef4444', color:'#fff' }} onClick={stopMic}>Mic OFF</button>}
        <button onClick={() => { stopMic(); fetch(`/api/session?code=${code}`, { method:'DELETE' }); }}>End Session</button>
        <div>Status: {status}</div>
      </div>

      <h3>Live Preview (spoken text)</h3>
      <div style={{ background:'#0f172a', color:'#e2e8f0', padding:'14px 16px', borderRadius:10, marginTop:8 }}>
        {log.length === 0 && <div>🕑 — No lines yet…</div>}
        {log.map((item, i) => (
          <div key={i} style={{ padding:'4px 0' }}>
            <span style={{ opacity: .6, marginRight: 8 }}>
              {new Date(item.ts).toLocaleTimeString()}
            </span>
            <span>🗣️ {item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
