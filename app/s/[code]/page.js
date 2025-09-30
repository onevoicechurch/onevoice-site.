'use client';
import { useEffect, useRef, useState } from 'react';

export default function Listener({ params }) {
  const code = decodeURIComponent(params.code);

  // viewer prefs
  const [myLang, setMyLang] = useState(
    typeof window !== 'undefined' ? (localStorage.getItem('ov:lang') || 'es') : 'es'
  );
  const [autoSpeak, setAutoSpeak] = useState(
    typeof window !== 'undefined' ? localStorage.getItem('ov:autoSpeak') === '1' : false
  );
  const [voice, setVoice] = useState(
    typeof window !== 'undefined' ? (localStorage.getItem('ov:voice') || 'alloy') : 'alloy'
  );

  // live lines
  const [log, setLog] = useState([]);

  // audio + queue
  const audioRef = useRef(null);
  const queueRef = useRef([]);        // pending sentences
  const speakingRef = useRef(false);
  const browserTTS = typeof window !== 'undefined' && 'speechSynthesis' in window;

  // persist prefs
  useEffect(() => { localStorage.setItem('ov:lang', myLang); }, [myLang]);
  useEffect(() => { localStorage.setItem('ov:autoSpeak', autoSpeak ? '1' : '0'); }, [autoSpeak]);
  useEffect(() => { localStorage.setItem('ov:voice', voice); }, [voice]);

  // subscribe to SSE stream
  useEffect(() => {
    const es = new EventSource(`/api/stream?code=${encodeURIComponent(code)}`);
    es.onmessage = (e) => {
      try {
        const line = JSON.parse(e.data);
        setLog((prev) => [...prev, line].slice(-200));

        const txt = line?.tx?.[myLang];
        if (autoSpeak && txt && txt.trim()) {
          // break into natural sentences
          splitIntoSentences(txt).forEach(s => queueRef.current.push(s));
          pumpSpeak();
        }
      } catch {}
    };
    es.addEventListener('end', () => es.close());
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, myLang, autoSpeak]);

  function splitIntoSentences(t) {
    // split by strong punctuation, keeping it attached
    const parts = t.split(/([.!?。！？]+)\s+/);
    const out = [];
    for (let i = 0; i < parts.length; i += 2) {
      const chunk = (parts[i] || '').trim();
      const punct = (parts[i + 1] || '').trim();
      const s = (chunk + (punct ? ' ' + punct : '')).trim();
      if (s) out.push(s);
    }
    return out.length ? out : [t];
  }

  async function pumpSpeak() {
    if (speakingRef.current) return;
    speakingRef.current = true;
    try {
      while (autoSpeak && queueRef.current.length) {
        const sentence = queueRef.current.shift();
        if (!sentence) continue;

        // try OpenAI TTS first, fallback to browser TTS
        const ok = await speakOpenAI(sentence, voice).catch(() => false);
        if (!ok && browserTTS) {
          await speakBrowser(sentence, myLang);
        }
      }
    } finally {
      speakingRef.current = false;
    }
  }

  async function speakOpenAI(text, v) {
    const r = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: v, format: 'mp3' }),
    });
    if (!r.ok) return false;
    const buf = await r.arrayBuffer();
    const blob = new Blob([buf], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);

    return new Promise((resolve) => {
      const el = audioRef.current || new Audio();
      audioRef.current = el;
      el.src = url;
      el.onended = () => { URL.revokeObjectURL(url); resolve(true); };
      el.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
      el.play().catch(() => resolve(false));  // user must interact once to allow autoplay
    });
  }

  function speakBrowser(text, lang) {
    return new Promise((resolve) => {
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang; // 'es', 'vi', 'zh', etc.
        const voices = window.speechSynthesis.getVoices();
        const v = voices.find(v => v.lang?.toLowerCase().startsWith(lang.toLowerCase()));
        if (v) u.voice = v;
        u.rate = 1.0; u.pitch = 1.0;
        u.onend = () => resolve(true);
        u.onerror = () => resolve(false);
        window.speechSynthesis.speak(u);
      } catch { resolve(false); }
    });
  }

  return (
    <main style={{ minHeight: '100vh', padding: 24, color: 'white',
                   background: 'linear-gradient(135deg,#0e1a2b,#153a74 60%,#0f3070)' }}>
      <div style={{ maxWidth: 840, margin: '0 auto' }}>
        <h1>OneVoice — Live Captions</h1>

        <div style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>Session: <code>{code}</code></div>

          <label>
            <span style={{ marginRight: 6 }}>My language:</span>
            <select value={myLang} onChange={(e) => setMyLang(e.target.value)} style={{ padding: 6, borderRadius: 8 }}>
              <option value="es">Spanish</option>
              <option value="vi">Vietnamese</option>
              <option value="zh">Chinese</option>
              {/* add more options that you actually send in ingest */}
            </select>
          </label>

          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={autoSpeak}
              onChange={(e) => setAutoSpeak(e.target.checked)}
            />
            🔊 Speak
          </label>

          <label>
            <span style={{ marginRight: 6 }}>Voice:</span>
            <select value={voice} onChange={(e) => setVoice(e.target.value)} style={{ padding: 6, borderRadius: 8 }}>
              <option value="alloy">Alloy</option>
              <option value="verse">Verse</option>
              <option value="sage">Sage</option>
              <option value="coral">Coral</option>
            </select>
          </label>
        </div>

        {/* hidden audio element for OpenAI playback */}
        <audio ref={audioRef} style={{ display: 'none' }} />

        <div style={{ background: '#0b1220', padding: 12, borderRadius: 8, lineHeight: 1.6, minHeight: 240 }}>
          {log.map((l) => (
            <div key={l.ts} style={{ marginBottom: 10 }}>
              <div style={{ opacity: 0.6, fontSize: 12 }}>{new Date(l.ts).toLocaleTimeString()}</div>
              <div>{l.tx?.[myLang]}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
