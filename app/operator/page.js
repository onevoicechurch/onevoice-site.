'use client';
import { useEffect, useRef, useState } from 'react';

const INPUT_LANGS = [
  { code: "AUTO", label: "Auto-detect (Whisper)" },
  { code: "en-US", label: "English (United States)" },
  { code: "en-GB", label: "English (United Kingdom)" },
  { code: "en-AU", label: "English (Australia)" },
  { code: "en-CA", label: "English (Canada)" },
  { code: "es-US", label: "Spanish (United States)" },
  { code: "es-ES", label: "Spanish (Spain)" },
  { code: "es-MX", label: "Spanish (Mexico)" },
  { code: "vi-VN", label: "Vietnamese (Vietnam)" },
];

export default function Operator() {
  const [code, setCode] = useState(null);
  const [inputLang, setInputLang] = useState('AUTO');
  const [langsCsv, setLangsCsv] = useState('es,vi,zh');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const mediaRef = useRef(null);
  const recRef = useRef(null);

  const siteOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://onevoice.church';
  const listenerUrl = code ? `${siteOrigin}/s/${encodeURIComponent(code)}` : '#';
  const qrUrl = code
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(listenerUrl)}`
    : '';

  // Load from localStorage only on client
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setCode(localStorage.getItem('ov:lastCode') || Math.random().toString(36).slice(2, 6).toUpperCase());
      setInputLang(localStorage.getItem('ov:inputLang') || 'AUTO');
      setLangsCsv(localStorage.getItem('ov:langs') || 'es,vi,zh');
    }
  }, []);

  // Persist to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined' && code) {
      localStorage.setItem('ov:lastCode', code);
      localStorage.setItem('ov:inputLang', inputLang);
      localStorage.setItem('ov:langs', langsCsv);
    }
  }, [code, inputLang, langsCsv]);

  // Live preview of the stream
  useEffect(() => {
    if (!code) return;
    const es = new EventSource(`/api/stream?code=${code}`);
    es.onmessage = (e) => {
      const line = JSON.parse(e.data);
      setLog((prev) => [...prev, line].slice(-150));
    };
    es.addEventListener("end", () => es.close());
    return () => es.close();
  }, [code]);

  async function startSession() {
    const res = await fetch('/api/session', { method: 'POST' });
    const j = await res.json();
    if (j.code) setCode(j.code);
  }

  async function endSession() {
    if (!code) return;
    await fetch(`/api/session?code=${code}`, { method: 'DELETE' });
    stopMic();
    setLog([]);
  }

  async function startMic() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true }, video: false });
    mediaRef.current = stream;

    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    recRef.current = rec;

    rec.ondataavailable = async (e) => {
      if (!e.data || e.data.size < 1500) return;
      try {
        const qs = new URLSearchParams({
          code,
          inputLang,
          langs: (langsCsv || 'es').replace(/\s+/g, '')
        });
        const ab = await e.data.arrayBuffer();
        await fetch('/api/ingest?' + qs.toString(), {
          method: 'POST',
          headers: { 'Content-Type': e.data.type || 'audio/webm' },
          body: ab
        });
      } catch (err) {
        console.error('ingest error', err);
      }
    };

    rec.start(1000); // send ~1s chunks
    setRunning(true);
  }

  function stopMic() {
    try { recRef.current?.stop(); } catch {}
    mediaRef.current?.getTracks().forEach(t => t.stop());
    setRunning(false);
  }

  return (
    <main style={{ minHeight: '100vh', padding: 24, color: 'white', background: 'linear-gradient(135deg,#0e1a2b,#153a74 60%,#0f3070)' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <h1>🎚️ Operator Console (Whisper)</h1>
        <p style={{ opacity: 0.9 }}>Share the code/QR. Set input language (or Auto). Choose target languages (csv). Start the mic.</p>

        {code && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center' }}>
            <div>
              <div style={{ marginBottom: 6 }}>Access Code</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <code style={{ background: 'rgba(255,255,255,0.15)', padding: '6px 10px', borderRadius: 8, fontSize: 20 }}>{code}</code>
                <button onClick={startSession} style={{ padding: '8px 12px', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>New Session</button>
                <a href={listenerUrl} target="_blank" rel="noreferrer" style={{ color: 'white', textDecoration: 'underline' }}>Open Listener</a>
              </div>
            </div>
            <div style={{ justifySelf: 'end' }}>
              {qrUrl && <img src={qrUrl} alt="QR" width={120} height={120} style={{ background: 'white', borderRadius: 8 }} />}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
          <label>
            <span style={{ marginRight: 8 }}>Input language:</span>
            <select value={inputLang} onChange={(e) => setInputLang(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
              {INPUT_LANGS.map((l) => (
                <option key={l.code} value={l.code} disabled={l.disabled}>{l.label}</option>
              ))}
            </select>
          </label>

          <label>
            <span style={{ marginRight: 8 }}>Offer languages (csv):</span>
            <input
              value={langsCsv}
              onChange={(e) => setLangsCsv(e.target.value)}
              placeholder="es,vi,zh"
              style={{ padding: 8, borderRadius: 8, width: 240 }}
            />
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

        <h3 style={{ marginTop: 18 }}>Live Preview</h3>
        <div style={{ background: '#0b1220', color: 'white', padding: 12, borderRadius: 8, minHeight: 160, lineHeight: 1.6 }}>
          {log.map((l) => {
            const first = (langsCsv || 'es').split(',')[0].trim();
            return (
              <div key={l.ts} style={{ marginBottom: 8 }}>
                <div style={{ opacity: 0.6, fontSize: 12 }}>{new Date(l.ts).toLocaleTimeString()}</div>
                <div>🗣️ {l.en}</div>
                <div>🌍 {l.tx?.[first]}</div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
