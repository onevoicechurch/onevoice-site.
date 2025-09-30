'use client';

import { useEffect, useRef, useState } from 'react';

// A lightweight set of common languages. Add/remove freely.
const LANG_OPTIONS = [
  ['es', 'Spanish'],
  ['en', 'English'],
  ['vi', 'Vietnamese'],
  ['zh', 'Chinese'],
  ['pt', 'Portuguese'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['ar', 'Arabic'],
  ['ru', 'Russian'],
  ['hi', 'Hindi'],
  ['ta', 'Tamil'],
  ['te', 'Telugu'],
  ['ko', 'Korean'],
  ['ja', 'Japanese'],
];

export default function ListenerPage({ params }) {
  const code = params.code;

  const [voices, setVoices] = useState([]);
  const [voiceId, setVoiceId] = useState('');
  const [speakEnabled, setSpeakEnabled] = useState(true);

  const [myLang, setMyLang] = useState('es'); // default language
  const [lines, setLines] = useState([]);

  const audioCtxRef = useRef(null);

  // 1) Pull available voices from our API (proxied to ElevenLabs)
  useEffect(() => {
    let canceled = false;
    fetch('/api/voices')
      .then(r => r.json())
      .then(data => {
        if (canceled) return;
        const list = data?.voices || [];
        setVoices(list);
        if (list.length && !voiceId) setVoiceId(list[0].voice_id);
      })
      .catch(() => {});
    return () => { canceled = true; };
  }, []);

  // 2) Subscribe to the live session via SSE and append lines
  useEffect(() => {
    if (!code) return;

    const es = new EventSource(`/api/stream?code=${encodeURIComponent(code)}`);

    es.onmessage = async (ev) => {
      try {
        const line = JSON.parse(ev.data); // { ts, en, tx: { es: "...", vi: "...", ... } }
        const display = pickText(line, myLang);

        setLines((prev) => [...prev, { ts: line.ts, text: display }].slice(-200));

        if (speakEnabled && display) {
          await playTTS(display, voiceId);
        }
      } catch {}
    };

    es.addEventListener('end', () => es.close());
    return () => es.close();
    // re-run if language or speak toggle changes (so new arrivals use updated prefs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, myLang, speakEnabled, voiceId]);

  // Helper: choose which string to show for the listener’s language
  function pickText(line, lang) {
    if (!line) return '';
    if (lang === 'en') return line.en || '';
    return line.tx?.[lang] || ''; // translated payload from your server
  }

  // Client-side: call our TTS proxy and play the returned audio
  async function playTTS(text, voiceId) {
    if (!text || !voiceId) return;
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voiceId,
          modelId: 'eleven_flash_v2_5', // cheap + low latency
        }),
      });
      if (!res.ok) return;

      const buf = await res.arrayBuffer();
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      const decoded = await ctx.decodeAudioData(buf);
      const src = ctx.createBufferSource();
      src.buffer = decoded;
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) {
      // non-fatal; just skip this chunk
      console.warn('TTS play error', e);
    }
  }

  return (
    <main style={{ minHeight: '100vh', padding: 24, color: 'white', background: 'linear-gradient(135deg,#0e1a2b,#153a74 60%,#0f3070)' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <h1 className="text-2xl font-bold">OneVoice — Live Captions</h1>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <div>Session: <code>{code}</code></div>

          <label>
            <span style={{ marginRight: 6 }}>My language:</span>
            <select
              value={myLang}
              onChange={(e) => setMyLang(e.target.value)}
              className="text-black p-1 rounded"
            >
              {LANG_OPTIONS.map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={speakEnabled}
              onChange={() => setSpeakEnabled((v) => !v)}
            />
            Speak
          </label>

          <label>
            <span style={{ marginRight: 6 }}>Voice:</span>
            <select
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              className="text-black p-1 rounded"
            >
              {voices.map(v => (
                <option key={v.voice_id} value={v.voice_id}>{v.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ background: '#0b1220', padding: 16, borderRadius: 12, marginTop: 16, minHeight: 260, lineHeight: 1.6 }}>
          {lines.map((l) => (
            <div key={l.ts + Math.random()} style={{ marginBottom: 8 }}>
              <div style={{ opacity: 0.6, fontSize: 12 }}>{new Date(l.ts).toLocaleTimeString()}</div>
              <div>🗣️ {l.text}</div>
            </div>
          ))}
          {!lines.length && <div style={{ opacity: 0.7 }}>Waiting for captions…</div>}
        </div>
      </div>
    </main>
  );
}
