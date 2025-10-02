'use client';

import { useEffect, useRef, useState } from 'react';

const LANGS = [
  { v: 'AUTO', label: 'Auto-detect' },
  { v: 'en', label: 'English (United States)' },
  { v: 'es', label: 'Spanish' },
  { v: 'pt', label: 'Portuguese' },
  { v: 'fr', label: 'French' },
  { v: 'de', label: 'German' },
];

export default function Operator() {
  const [code, setCode] = useState(null);
  const [inputLang, setInputLang] = useState('AUTO');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Mic OFF');
  const [log, setLog] = useState([]);
  const [errorText, setErrorText] = useState(null);

  const mediaRef = useRef(null);
  const recRef = useRef(null);
  const sseRef = useRef(null);

  function pushLog(line) {
    setLog(prev => [{ ts: Date.now(), line }, ...prev].slice(0, 200));
  }

  async function createSession(lang = inputLang) {
    const r = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputLang: lang }),
    }).then(r => r.json()).catch(() => ({ ok: false }));

    if (!r?.ok || !r?.code) {
      pushLog('❌ Failed to create session');
      return null;
    }
    setCode(r.code);
    pushLog(`Session ${r.code} ready`);
    startSSE(r.code);
    return r.code;
  }

  function startSSE(c) {
    try { sseRef.current?.close?.(); } catch {}
    const es = new EventSource(`/api/stream?code=${encodeURIComponent(c)}`);
    sseRef.current = es;
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg?.type === 'transcript' && msg?.text) pushLog(msg.text);
      } catch {}
    };
    es.onerror = () => {
      try { es.close(); } catch {}
      setTimeout(() => startSSE(c), 1000);
    };
  }

  useEffect(() => {
    createSession();
    return () => { try { sseRef.current?.close(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onChangeLang(v) {
    setInputLang(v);
    if (!code) return;
    await fetch('/api/session', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, inputLang: v }),
    }).catch(() => {});
  }

  async function toggleMic() {
    if (running) {
      await stopMic(true);
    } else {
      await startMic();
    }
  }

  // ---- WAV encoding helpers (client-side) -----------------------------------

  // Encode Float32 PCM → 16-bit PCM WAV (mono)
  function encodeWAV(float32, sampleRate) {
    // Convert Float32 [-1,1] to 16-bit PCM
    const pcm16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      let s = Math.max(-1, Math.min(1, float32[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    const bytesPerSample = 2; // 16-bit
    const blockAlign = 1 * bytesPerSample; // mono
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcm16.length * bytesPerSample;
    const headerSize = 44;
    const buffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(buffer);

    let p = 0;
    function writeStr(s) { for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i)); }
    function writeU32(v) { view.setUint32(p, v, true); p += 4; }
    function writeU16(v) { view.setUint16(p, v, true); p += 2; }

    writeStr('RIFF');
    writeU32(36 + dataSize);          // file size - 8
    writeStr('WAVE');
    writeStr('fmt ');
    writeU32(16);                     // PCM chunk size
    writeU16(1);                      // PCM format
    writeU16(1);                      // channels = 1 (mono)
    writeU32(sampleRate);
    writeU32(byteRate);
    writeU16(blockAlign);
    writeU16(16);                     // bits per sample
    writeStr('data');
    writeU32(dataSize);

    // PCM samples
    let o = headerSize;
    for (let i = 0; i < pcm16.length; i++, o += 2) view.setInt16(o, pcm16[i], true);

    return new Blob([buffer], { type: 'audio/wav' });
  }

  // Convert incoming webm/opus chunk → WAV (mono)
  async function webmChunkToWav(blob) {
    const arrayBuf = await blob.arrayBuffer();

    // Decode with WebAudio
    const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 48000 * 3, 48000);
    // Fallback: use a normal AudioContext to decode
    let decodeCtx;
    try {
      decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      throw new Error('AudioContext not supported');
    }

    const audioBuf = await new Promise((resolve, reject) => {
      decodeCtx.decodeAudioData(
        arrayBuf.slice(0),
        buf => resolve(buf),
        err => reject(err)
      );
    });

    // Downmix to mono
    const ch0 = audioBuf.getChannelData(0);
    let mono;
    if (audioBuf.numberOfChannels > 1) {
      const ch1 = audioBuf.getChannelData(1);
      const len = Math.min(ch0.length, ch1.length);
      mono = new Float32Array(len);
      for (let i = 0; i < len; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5;
    } else {
      mono = ch0;
    }

    const wavBlob = encodeWAV(mono, audioBuf.sampleRate || 48000);
    try { decodeCtx.close(); } catch {}
    return wavBlob;
  }

  // ---------------------------------------------------------------------------

  async function startMic() {
    const current = code || await createSession(inputLang);
    if (!current) return;

    setErrorText(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRef.current = stream;

      // Record as webm/opus for broad support
      let mime = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mime)) mime = 'audio/webm';
      const mr = new MediaRecorder(stream, { mimeType: mime });
      recRef.current = { mr };

      mr.ondataavailable = async (ev) => {
        if (!ev.data || ev.data.size === 0) return;
        try {
          // Convert this chunk to WAV, then send
          const wavBlob = await webmChunkToWav(ev.data);

          const qs = new URLSearchParams({
            code: current,
            lang: inputLang === 'AUTO' ? 'auto' : inputLang
          }).toString();

          await fetch(`/api/ingest?${qs}`, {
            method: 'POST',
            headers: { 'Content-Type': 'audio/wav' },
            body: await wavBlob.arrayBuffer(),
          }).catch(() => {});
        } catch (err) {
          console.error('WAV conversion failed:', err);
          setErrorText('Audio conversion failed. See console.');
        }
      };

      mr.start(1000); // ~1s chunks

      setRunning(true);
      setStatus('Mic ON');
    } catch (err) {
      console.error(err);
      alert('Microphone not available or permission denied.');
    }
  }

  async function stopMic(finalFlush = false) {
    setRunning(false);
    setStatus('Mic OFF');
    try { recRef.current?.mr?.stop(); } catch {}
    try { mediaRef.current?.getTracks?.().forEach(t => t.stop()); } catch {}
    if (finalFlush && code) {
      const qs = new URLSearchParams({ code }).toString();
      await fetch(`/api/ingest?${qs}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flush: 1 }) }).catch(()=>{});
    }
  }

  return (
    <div style={{ padding: '24px', maxWidth: 1000, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 28, marginBottom: 12 }}>🖥️ Operator Console (Whisper)</h1>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div><b>Access Code:</b> {code || '----'}</div>
        <button onClick={() => createSession()}>New Session</button>
        <a href={code ? `/s/${code}` : '#'} target="_blank" rel="noreferrer">Open Listener</a>

        <div>
          <label>Input language:&nbsp;</label>
          <select value={inputLang} onChange={(e) => onChangeLang(e.target.value)}>
            {LANGS.map(l => <option key={l.v} value={l.v}>{l.label}</option>)}
          </select>
        </div>

        <button
          onClick={toggleMic}
          style={{ background: running ? '#16a34a' : '#ef4444', color:'#fff', padding:'6px 12px', borderRadius:6 }}
        >
          {running ? 'Mic ON' : 'Mic OFF'}
        </button>

        <button onClick={() => stopMic(true)}>End Session</button>
        <div> Status: {status}</div>
      </div>

      {errorText && (
        <div style={{ marginTop: 12, background:'#fee2e2', color:'#7f1d1d', padding:10, borderRadius:6 }}>
          {errorText}
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>Live Preview (spoken text)</h3>
      <div style={{ background: '#0f1820', color: '#dfe7ef', padding: 16, borderRadius: 8, minHeight: 160 }}>
        {log.map((r, i) => (
          <div key={i} style={{ opacity: i ? 0.8 : 1 }}>
            <small>{new Date(r.ts).toLocaleTimeString()} — </small> {r.line}
          </div>
        ))}
      </div>
    </div>
  );
}
