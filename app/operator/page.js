'use client';

import { useEffect, useRef, useState } from 'react';

const LANGS = [
  { v:'AUTO', label:'Auto-detect' },
  { v:'en', label:'English (United States)' },
  { v:'es', label:'Spanish' },
  { v:'pt', label:'Portuguese' },
  { v:'fr', label:'French' },
  { v:'de', label:'German' }
];

export default function Operator() {
  const [code, setCode] = useState(null);
  const [inputLang, setInputLang] = useState('AUTO');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('—');
  const [log, setLog] = useState([]);

  const mediaRef = useRef(null);
  const recRef   = useRef(null);
  const analyserRef = useRef(null);
  const silenceMsRef = useRef(0);
  const lastChunkAtRef = useRef(0);
  const sseRef = useRef(null);

  function pushLog(line) {
    setLog(prev => [{ ts: Date.now(), line }, ...prev].slice(0,200));
  }

  async function newSession() {
    const r = await fetch('/api/session', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ inputLang })
    }).then(r=>r.json());
    if (!r.ok) { alert('Failed to create session'); return; }
    setCode(r.code);
    pushLog(`Session ${r.code} ready`);
    setStatus('Session ready');
    startSSE(r.code);
  }

  function startSSE(c) {
    if (sseRef.current) sseRef.current.close();
    const es = new EventSource(`/api/stream?code=${c}`);
    sseRef.current = es;
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'transcript' && msg.text) {
          pushLog(msg.text);
        }
      } catch {}
    };
    es.onerror = () => {
      es.close();
      // auto-reconnect
      setTimeout(()=> startSSE(c), 1000);
    };
  }

  async function toggleMic() {
    if (running) {
      await stopMic(true);
    } else {
      await startMic();
    }
  }

  async function startMic() {
    if (!code) await newSession();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
      mediaRef.current = stream;

      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      analyserRef.current = analyser;

      // Mic state
      setRunning(true);
      setStatus('Mic ON');

      // Silence detector
      silenceMsRef.current = 0;
      lastChunkAtRef.current = Date.now();
      const vadTimer = setInterval(async ()=>{
        // Measure amplitude
        const buf = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteTimeDomainData(buf);
        let mean = 0;
        for (let i=0;i<buf.length;i++){
          const v = (buf[i] - 128)/128;
          mean += v*v;
        }
        mean = Math.sqrt(mean/buf.length); // RMS ~ 0..1
        const silent = mean < 0.015; // tune as needed

        if (silent) {
          silenceMsRef.current += 200;
        } else {
          silenceMsRef.current = 0;
        }

        // If we have at least ~2.5s of speech since last flush AND ~600ms silence → flush
        const since = Date.now() - lastChunkAtRef.current;
        if (since > 2500 && silenceMsRef.current > 600) {
          await fetch(`/api/ingest?code=${code}&flush=1`, { method:'POST' }).catch(()=>{});
          lastChunkAtRef.current = Date.now();
        }
      }, 200);

      // MediaRecorder (1s chunks)
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      recRef.current = { mr, vadTimer, ctx };

      mr.ondataavailable = async (ev) => {
        if (ev.data && ev.data.size > 0) {
          const buf = await ev.data.arrayBuffer();
          lastChunkAtRef.current = Date.now();
          await fetch(`/api/ingest?code=${code}`, {
            method:'POST',
            body: buf
          }).catch(()=>{});
        }
      };
      mr.start(1000);
    } catch (e) {
      console.error(e);
      alert('Microphone not available');
    }
  }

  async function stopMic(finalFlush=false) {
    setRunning(false);
    setStatus('Mic OFF');

    try {
      recRef.current?.mr?.stop();
    } catch {}
    try { mediaRef.current?.getTracks?.().forEach(t=>t.stop()); } catch {}
    try { clearInterval(recRef.current?.vadTimer); } catch {}
    try { recRef.current?.ctx?.close(); } catch {}

    if (finalFlush) {
      await fetch(`/api/ingest?code=${code}&final=1`, { method:'POST' }).catch(()=>{});
    }
  }

  useEffect(()=>{
    // create a session automatically on first load
    newSession();
    return ()=> {
      try { sseRef.current?.close(); } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updateLang(v) {
    setInputLang(v);
    if (code) {
      await fetch('/api/session', {
        method:'PATCH',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ code, inputLang: v })
      });
    }
  }

  const micLabel = running ? 'Mic ON' : 'Mic OFF';

  return (
    <div style={{ padding:'24px', maxWidth:1000, margin:'0 auto', fontFamily:'system-ui, sans-serif' }}>
      <h1 style={{ fontSize:28, marginBottom:12 }}>🖥️ Operator Console (Whisper)</h1>

      <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
        <div><b>Access Code:</b> {code || '----'}</div>
        <button onClick={newSession}>New Session</button>
        <a href={code ? `/s/${code}` : '#'} target="_blank" rel="noreferrer">Open Listener</a>
        <div>
          <label>Input language:&nbsp;</label>
          <select value={inputLang} onChange={e=>updateLang(e.target.value)}>
            {LANGS.map(l => <option key={l.v} value={l.v}>{l.label}</option>)}
          </select>
        </div>
        <button
          onClick={toggleMic}
          style={{ background: running ? '#16a34a' : '#ef4444', color:'#fff', padding:'6px 12px', borderRadius:6 }}
        >{micLabel}</button>
        <button onClick={()=>stopMic(true)}>End Session</button>
        <div> Status: {status}</div>
      </div>

      <h3 style={{ marginTop:24 }}>Live Preview (spoken text)</h3>
      <div style={{ background:'#0f1820', color:'#dfe7ef', padding:16, borderRadius:8, minHeight:160 }}>
        {log.map((r,i)=>(
          <div key={i} style={{ opacity: i?0.8:1 }}>
            <small>{new Date(r.ts).toLocaleTimeString()} — </small> {r.line}
          </div>
        ))}
      </div>
    </div>
  );
}
