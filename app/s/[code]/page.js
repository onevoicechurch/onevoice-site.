'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const TERMINATORS = /[.!?…]+["”’)]*$/;
const NUMBERS_ONLY = /^\s*\d+(?:\s*,\s*\d+)*\s*$/;      // e.g., "2, 3"
const THROWAWAY = /^(um+|uh+|erm|mm+|hmm+|ah+|eh+)$/i;  // obvious fillers

export default function ListenerPage({ params }) {
  const code = params.code;

  // UI state
  const [lines, setLines] = useState([]);           // what we render
  const [voices, setVoices] = useState([]);
  const [voiceId, setVoiceId] = useState(null);
  const [speakEnabled, setSpeakEnabled] = useState(true);

  // SSE & queue state
  const esRef = useRef(null);
  const lastTsRef = useRef(0);                      // last timestamp we processed
  const bufferRef = useRef('');                     // sentence buffer
  const ttsQueueRef = useRef([]);                   // [{text}]
  const playingRef = useRef(false);                 // queue lock
  const audioRef = useRef(null);

  // ---------- load available voices ----------
  useEffect(() => {
    let alive = true;
    fetch('/api/voices')
      .then(r => r.json())
      .then(data => {
        if (!alive) return;
        const v = data?.voices || [];
        setVoices(v);
        if (v.length) setVoiceId(v[0].voice_id);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // ---------- connect SSE ----------
  useEffect(() => {
    if (!code) return;

    const es = new EventSource(`/api/stream?code=${encodeURIComponent(code)}`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const line = JSON.parse(e.data); // {ts, en, tx?}
        if (!line?.ts) return;

        // de-dup history on initial connect
        if (line.ts <= lastTsRef.current) return;
        lastTsRef.current = line.ts;

        const spoken = (line.en || '').trim();
        if (!spoken) return;

        // keep a readable log
        setLines((prev) => [...prev, { ts: line.ts, text: spoken }].slice(-300));

        // 1) discard trivial fillers
        if (THROWAWAY.test(spoken)) return;

        // 2) stitch countdown “2, 3” etc. onto prior clause
        let merged = false;
        if (NUMBERS_ONLY.test(spoken)) {
          const cur = bufferRef.current.replace(/\s+/g, ' ').trim();
          if (cur) {
            bufferRef.current = cur + ' ' + spoken.replace(/\s+/g, ' ').trim();
            merged = true;
          }
        }

        // 3) accumulate into buffer; flush on sentence boundary or big chunk
        if (!merged) {
          const chunk = spoken.replace(/\s+/g, ' ').trim();
          if (!chunk) return;
          bufferRef.current = (bufferRef.current + ' ' + chunk).trim();
        }

        const ready = shouldFlush(bufferRef.current);
        if (ready) {
          const toSpeak = finalize(bufferRef.current);
          bufferRef.current = '';
          if (speakEnabled) enqueueTTS(toSpeak, voiceId);
        }
      } catch {}
    };

    es.addEventListener('end', () => {
      es.close();
      // flush whatever remains
      const leftover = finalize(bufferRef.current);
      bufferRef.current = '';
      if (leftover && speakEnabled) enqueueTTS(leftover, voiceId);
    });

    return () => {
      es.close();
      esRef.current = null;
      bufferRef.current = '';
      ttsQueueRef.current = [];
      playingRef.current = false;
      if (audioRef.current) {
        try { audioRef.current.pause(); } catch {}
        audioRef.current = null;
      }
    };
  }, [code, speakEnabled, voiceId]);

  // ---------- TTS queue ----------
  function enqueueTTS(text, vid) {
    if (!text?.trim() || !vid) return;
    const q = ttsQueueRef.current;

    // drop exact dup with last queued item
    if (q.length && q[q.length - 1].text === text) return;

    q.push({ text, voiceId: vid });
    if (!playingRef.current) playNext();
  }

  async function playNext() {
    const q = ttsQueueRef.current;
    if (!q.length) { playingRef.current = false; return; }
    playingRef.current = true;

    const { text, voiceId: vid } = q.shift();
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voiceId: vid,
          modelId: 'eleven_flash_v2_5',
        }),
      });
      if (!res.ok) throw new Error('TTS failed');
      const ab = await res.arrayBuffer();
      const blob = new Blob([ab], { type: 'audio/mpeg' });

      // single audio element, play sequentially
      if (!audioRef.current) audioRef.current = new Audio();
      const a = audioRef.current;
      a.src = URL.createObjectURL(blob);

      await a.play().catch(() => {});    // start
      await waitForEnd(a);               // wait until ended
    } catch {
      // swallow one-off errors and continue
    } finally {
      playNext();
    }
  }

  function waitForEnd(audio) {
    return new Promise((resolve) => {
      const onEnd = () => {
        audio.removeEventListener('ended', onEnd);
        resolve();
      };
      audio.addEventListener('ended', onEnd, { once: true });
    });
  }

  // ---------- helpers ----------
  function shouldFlush(s) {
    const t = s.trim();
    if (!t) return false;
    // flush if it ends like a sentence, or grows long
    if (TERMINATORS.test(t)) return true;
    if (t.length > 180) return true;        // long thought; don’t hold forever
    return false;
  }

  function finalize(s) {
    let out = (s || '').replace(/\s+/g, ' ').trim();

    // normalize stray commas/series like “One, 2, 3,”
    out = out.replace(/\s*,\s*/g, ', ');
    out = out.replace(/\s+,/g, ',');
    out = out.replace(/\s+([.!?…])/g, '$1');

    // ensure sentence end if it feels like a sentence
    if (!TERMINATORS.test(out) && out.length > 1) out += '.';
    return out;
  }

  const rendered = useMemo(() => lines, [lines]);

  // ---------- UI ----------
  return (
    <main style={{ minHeight: '100vh', padding: 24, color: 'white', background: 'linear-gradient(135deg,#0e1a2b,#153a74 60%,#0f3070)' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <h1>OneVoice — Live Captions</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>Session: <code>{code}</code></div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={speakEnabled} onChange={(e) => setSpeakEnabled(e.target.checked)} />
            <span>Speak</span>
          </label>
          <label>
            <span style={{ marginRight: 6 }}>Voice:</span>
            <select value={voiceId || ''} onChange={(e) => setVoiceId(e.target.value)} style={{ padding: 6, borderRadius: 8 }}>
              {voices.map(v => (
                <option key={v.voice_id} value={v.voice_id}>{v.name || v.voice_id}</option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ background: '#0b1220', color: 'white', padding: 16, borderRadius: 10, marginTop: 16 }}>
          {rendered.map((l) => (
            <div key={l.ts} style={{ marginBottom: 10 }}>
              <div style={{ opacity: 0.6, fontSize: 12 }}>{new Date(l.ts).toLocaleTimeString()}</div>
              <div>🗣️ {l.text}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
