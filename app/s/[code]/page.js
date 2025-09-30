'use client';

import { useEffect, useRef, useState } from 'react';

// 50+ language options (BCP-47-ish or ISO codes for display)
const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'nl', label: 'Dutch' },
  { code: 'sv', label: 'Swedish' },
  { code: 'no', label: 'Norwegian' },
  { code: 'da', label: 'Danish' },
  { code: 'fi', label: 'Finnish' },
  { code: 'pl', label: 'Polish' },
  { code: 'cs', label: 'Czech' },
  { code: 'ro', label: 'Romanian' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'tr', label: 'Turkish' },
  { code: 'el', label: 'Greek' },
  { code: 'ru', label: 'Russian' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'ar', label: 'Arabic' },
  { code: 'he', label: 'Hebrew' },
  { code: 'hi', label: 'Hindi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'mr', label: 'Marathi' },
  { code: 'gu', label: 'Gujarati' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'id', label: 'Indonesian' },
  { code: 'ms', label: 'Malay' },
  { code: 'th', label: 'Thai' },
  { code: 'ko', label: 'Korean' },
  { code: 'ja', label: 'Japanese' },
  { code: 'zh', label: 'Chinese' },
  { code: 'sw', label: 'Swahili' },
  { code: 'am', label: 'Amharic' },
  { code: 'fa', label: 'Persian' },
  { code: 'ur', label: 'Urdu' },
  { code: 'yo', label: 'Yoruba' },
  { code: 'ig', label: 'Igbo' },
  { code: 'ha', label: 'Hausa' },
  { code: 'af', label: 'Afrikaans' },
  { code: 'bg', label: 'Bulgarian' },
  { code: 'hr', label: 'Croatian' },
  { code: 'sr', label: 'Serbian' },
  { code: 'sk', label: 'Slovak' },
  { code: 'sl', label: 'Slovenian' },
];

export default function ListenerPage({ params }) {
  const code = decodeURIComponent(params.code || '');

  const [speakEnabled, setSpeakEnabled] = useState(true);
  const [voices, setVoices] = useState([]);
  const [voiceId, setVoiceId] = useState(null);
  const [lang, setLang] = useState('en'); // default English
  const [lines, setLines] = useState([]);

  // TTS queue (strict order, no overlaps, never re-read history)
  const audioRef = useRef(null);
  const queueRef = useRef([]);      // array<{url}>
  const playingRef = useRef(false);

  // load ElevenLabs voices from our API proxy
  useEffect(() => {
    fetch('/api/voices')
      .then((r) => r.json())
      .then((j) => {
        const list = j?.voices || [];
        setVoices(list);
        if (list.length && !voiceId) setVoiceId(list[0].voice_id);
      }).catch(() => {});
    // create a single audio element for queue
    audioRef.current = new Audio();
    audioRef.current.addEventListener('ended', () => {
      playingRef.current = false;
      playNextInQueue();
    });
  }, []);

  // subscribe to SSE stream
  useEffect(() => {
    if (!code) return;
    const es = new EventSource(`/api/stream?code=${encodeURIComponent(code)}`);
    es.onmessage = async (e) => {
      const msg = JSON.parse(e.data || '{}'); // { ts, en }
      const ts = msg.ts || Date.now();
      const english = (msg.en || '').trim();
      if (!english) return;

      // translate on-demand for each listener’s chosen language
      let outText = english;
      if (lang && lang !== 'en') {
        try {
          const r = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: english, to: lang }),
          });
          if (r.ok) {
            const j = await r.json();
            outText = (j?.text || english).trim();
          }
        } catch {
          // fallback to English if translation fails
          outText = english;
        }
      }

      // render the line
      setLines((prev) => [...prev, { ts, text: outText }].slice(-400));

      // queue speech (only for *new* line, never replay old ones)
      if (speakEnabled && voiceId && outText) {
        enqueueTTS(outText);
      }
    };
    es.addEventListener('end', () => es.close());
    return () => es.close();
  }, [code, speakEnabled, voiceId, lang]); // re-subscribe if these change

  function enqueueTTS(text) {
    queueRef.current.push({ text });
    if (!playingRef.current) playNextInQueue();
  }

  async function playNextInQueue() {
    if (playingRef.current) return;
    const item = queueRef.current.shift();
    if (!item) return;

    playingRef.current = true;
    try {
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: item.text,
          voiceId,
          modelId: 'eleven_flash_v2_5', // cost-effective, good quality
        }),
      });
      if (!r.ok) throw new Error('tts failed');
      const ab = await r.arrayBuffer();
      const blob = new Blob([ab], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      audioRef.current.src = url;
      audioRef.current.play().catch(() => {
        // autoplay can be blocked until user gesture
        playingRef.current = false;
      });
    } catch (e) {
      playingRef.current = false;
    }
  }

  return (
    <main style={{ minHeight: '100vh', padding: 24, color: 'white', background: 'linear-gradient(135deg,#0e1a2b,#153a74 60%,#0f3070)' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <h1>OneVoice — Live Captions</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>Session: <code>{code}</code></div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            My language:
            <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ padding: 6, borderRadius: 8 }}>
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={speakEnabled} onChange={(e) => setSpeakEnabled(e.target.checked)} />
            🗣️ Speak
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Voice:
            <select value={voiceId || ''} onChange={(e) => setVoiceId(e.target.value)} style={{ padding: 6, borderRadius: 8 }}>
              {voices.map((v) => (
                <option key={v.voice_id} value={v.voice_id}>{v.name || v.voice_id}</option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ background: '#0b1220', color: 'white', padding: 16, borderRadius: 10, marginTop: 16 }}>
          {lines.map((l, i) => (
            <div key={l.ts + '-' + i} style={{ marginBottom: 10 }}>
              <div style={{ opacity: 0.6, fontSize: 12 }}>{new Date(l.ts).toLocaleTimeString()}</div>
              <div>🗨️ {l.text}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
