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

// --- WAV helpers -------------------------------------------------------------

function interleaveToMono(float32Arrays) {
  // If stereo, average to mono
  if (float32Arrays.length === 1) return float32Arrays[0];
  const [L, R] = float32Arrays;
  const len = Math.min(L.length, R.length);
  const mono = new Float32Array(len);
  for (let i = 0; i < len; i++) mono[i] = (L[i] + R[i]) * 0.5;
  return mono;
}

function floatTo16BitPCM(float32) {
  const out = new DataView(new ArrayBuffer(float32.length * 2));
  let o = 0;
  for (let i = 0; i < float32.length; i++, o += 2) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7FFF;
    out.setInt16(o, s, true);
  }
  return out;
}

function writeWavHeader(view, sampleRate, numSamples) {
  // RIFF header for PCM 16-bit mono
  const blockAlign = 2;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * 2;

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);        // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);         // AudioFormat = 1 (PCM)
  view.setUint16(22, 1, true);         // NumChannels = 1 (mono)
  view.setUint32(24, sampleRate, true);// SampleRate
  view.setUint32(28, byteRate, true);  // ByteRate
  view.setUint16(32, blockAlign, true);// BlockAlign
  view.setUint16(34, 16, true);        // BitsPerSample

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

async function webmChunkToWavBlob(webmBlob) {
  // Decode with WebAudio, then re-encode to WAV (PCM 16-bit mono)
  const arr = await webmBlob.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuf = await audioCtx.decodeAudioData(arr);

  const sampleRate = audioBuf.sampleRate;
  const channels = [];
  for (let c = 0; c < audioBuf.numberOfChannels; c++) {
    channels.push(audioBuf.getChannelData(c));
  }
  const mono = interleaveToMono(channels);
  const pcm16 = floatTo16BitPCM(mono);

  const wavBuffer = new ArrayBuffer(44 + pcm16.byteLength);
  const view = new DataView(wavBuffer);
  writeWavHeader(view, sampleRate, mono.length);

  // PCM data
  const wavBytes = new Uint8Array(wavBuffer);
  wavBytes.set(new Uint8Array(pcm16.buffer), 44);

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

// ----------------------------------------------------------------------------

export default function Operator() {
  const [code, setCode] = useState(null);
  const [inputLang, setInputLang] = useState('AUTO');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Mic OFF');
  const [errorText, setErrorText] = useState(null);
  const [log, setLog] = useState([]);

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
      setErrorText('Failed to create session');
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
    if (running) await stopMic(true);
    else await startMic();
  }

  async function startMic() {
    const current = code || await createSession(inputLang);
    if (!current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRef.current = stream;

      // MediaRecorder as Opus/WebM – we'll convert to WAV on each chunk
      let mime = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mime)) mime = 'audio/webm';
      const mr = new MediaRecorder(stream, { mimeType: mime });
      recRef.current = mr;

      mr.ondataavailable = async (ev) => {
        if (!ev.data || ev.data.size === 0) return;
        setErrorText(null);

        try {
          // Convert the webm chunk to PCM WAV
          const wavBlob = await webmChunkToWavBlob(ev.data);

          const form = new FormData();
          form.append('audio', wavBlob, 'chunk.wav');
          form.append('code', current);
          form.append('lang', inputLang === 'AUTO' ? '' : inputLang);

          const resp = await fetch('/api/ingest', { method: 'POST', body: form });
          const j = await resp.json().catch(() => null);
          if (!resp.ok || j?.ok === false) {
            setErrorText(j?.error || `Ingest error ${resp.status}`);
          }
        } catch (e) {
          setErrorText('Audio conversion failed. See console.');
          console.error(e);
        }
      };

      mr.start(1000); // ~1s chunks
      setRunning(true);
      setStatus('Mic ON');
    } catch (err) {
      console.error(err);
      setErrorText('Microphone not available or permission denied.');
    }
  }

  async function stopMic(finalFlush = false) {
    setRunning(false);
    setStatus('Mic OFF');
    try { recRef.current?.stop(); } catch {}
    try { mediaRef.current?.getTracks?.().forEach(t => t.stop()); } catch {}

    if (finalFlush && code) {
      await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      }).catch(() => {});
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
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
          style={{ background: running ? '#16a34a' : '#ef4444', color: '#fff', padding: '6px 12px', borderRadius: 6 }}
        >
          {running ? 'Mic ON' : 'Mic OFF'}
        </button>

        <button onClick={() => stopMic(true)}>End Session</button>
        <div> Status: {status}</div>
      </div>

      {errorText && (
        <div style={{ marginTop: 12, padding: 10, background: '#fee2e2', color: '#7f1d1d', borderRadius: 6 }}>
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
