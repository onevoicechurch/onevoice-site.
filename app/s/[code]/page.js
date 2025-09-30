'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const VOICE_CHOICES = [
  // These names are *browser* voices; they vary per device.
  // Pick safe fallbacks; we’ll match by substring.
  'Alloy', 'Samantha', 'Google español', 'Microsoft Sabina', 'Daniel', 'Victoria',
];

export default function Listener({ params }) {
  const code = params.code;

  const [lang, setLang] = useState(() => localStorage.getItem('ov:viewerLang') || 'es');
  const [speak, setSpeak] = useState(() => localStorage.getItem('ov:speak') === '1');
  const [voiceName, setVoiceName] = useState(() => localStorage.getItem('ov:voiceName') || 'Alloy');
  const [lines, setLines] = useState([]);

  // speech
  const voicesRef = useRef([]);
  const utterQ = useRef([]); // queue of pending strings to speak
  const speakingRef = useRef(false);

  useEffect(() => {
    localStorage.setItem('ov:viewerLang', lang);
  }, [lang]);
  useEffect(() => {
    localStorage.setItem('ov:speak', speak ? '1' : '0');
  }, [speak]);
  useEffect(() => {
    localStorage.setItem('ov:voiceName', voiceName);
  }, [voiceName]);

  // subscribe to server events
  useEffect(() => {
    const es = new EventSource(`/api/stream?code=${encodeURIComponent(code)}`);
    es.onmessage = (e) => {
      try {
        const line = JSON.parse(e.data);
        setLines((prev) => [...prev, line].slice(-200));
        if (speak) {
          const text = line.tx?.[lang] || '';
          if (text) {
            utterQ.current.push(text);
            pumpSpeech();
          }
        }
      } catch {}
    };
    es.addEventListener('end', () => es.close());
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, lang, speak]);

  // load voices (Web Speech API)
  useEffect(() => {
    const load = () => { voicesRef.current = window.speechSynthesis.getVoices() || []; };
    load();
    window.speechSynthesis.onvoiceschanged = load;
  }, []);

  function pickVoice() {
    const vs = voicesRef.current;
    // try by includes() to be resilient
    const found = vs.find(v => v.name.toLowerCase().includes(voiceName.toLowerCase()));
    return found || vs[0] || null;
  }

  function pumpSpeech() {
    if (speakingRef.current) return;
    if (!utterQ.current.length) return;
    const txt = utterQ.current.shift();

    const u = new SpeechSynthesisUtterance(txt);
    const v = pickVoice();
    if (v) u.voice = v;

    // set language hint for better prosody (best effort)
    if (lang.startsWith('es')) u.lang = 'es-ES';
    else if (lang.startsWith('vi')) u.lang = 'vi-VN';
    else if (lang.startsWith('zh')) u.lang = 'zh-CN';

    u.rate = 1.0;
    u.pitch = 1.0;
    speakingRef.current = true;
    u.onend = () => {
      speakingRef.current = false;
      pumpSpeech();
    };
    window.speechSynthesis.speak(u);
  }

  const latest = useMemo(() => lines[lines.length - 1], [lines]);
  const shown = latest ? (latest.tx?.[lang] || '') : '';

  return (
    <main style={{ minHeight: '100vh', padding: 24, color: 'white', background: 'linear-gradient(135deg,#0e1a2b,#153a74 60%,#0f3070)' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <h1>OneVoice — Live Captions</h1>
        <div style={{ margin: '8px 0 16px', opacity: 0.9 }}>
          <span style={{ marginRight: 12 }}>Session: <code>{code}</code></span>
          <label style={{ marginRight: 8 }}>My language:{' '}
            <select value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="es">Spanish</option>
              <option value="vi">Vietnamese</option>
              <option value="zh">Chinese</option>
              <option value="en">English</option>
            </select>
          </label>
          <label style={{ marginRight: 8 }}>
            🗣️ Speak{' '}
            <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} />
          </label>
          <label>
            Voice:{' '}
            <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)}>
              {VOICE_CHOICES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>

        <div style={{ background: '#0b1220', borderRadius: 8, padding: 16, minHeight: 220, lineHeight: 1.6 }}>
          {lines.length === 0 ? (
            <div style={{ opacity: 0.7 }}>Waiting for captions…</div>
          ) : (
            <>
              {/* show the latest translation big */}
              <div style={{ fontSize: 20, marginBottom: 12 }}>{shown}</div>
              {/* and a light transcript history below */}
              <div style={{ opacity: 0.8, fontSize: 14 }}>
                {lines.slice(-12).map((l) => (
                  <div key={l.ts}>{new Date(l.ts).toLocaleTimeString()} — {l.tx?.[lang] || l.en}</div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
