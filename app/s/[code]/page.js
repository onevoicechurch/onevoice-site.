'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/** ---- Thoughtful flush heuristics ---- */
const TERMINATORS = /[.!?…]+["”’)]*$/;
const NUMBERS_ONLY = /^\s*\d+(?:\s*,\s*\d+)*\s*$/;                 // "2, 3"
const THROWAWAY = /^(um+|uh+|erm|mm+|hmm+|ah+|eh+)$/i;              // fillers

// phrases that often end a thought while preaching
const SOFT_ENDERS = [
  'right', 'okay', 'ok', 'amen', 'you know', 'you know?',
  'what do you think', 'come on', 'can i get an amen', 'all right', 'alright'
];

const FLUSH_GAP_MS   = 1400;   // flush if this much “silence” since last chunk
const MAX_PHRASE_LEN = 140;    // flush if a thought grows long

export default function ListenerPage({ params }) {
  const code = params.code;

  // UI state
  const [lines, setLines] = useState([]);            // rendered transcript for this listener
  const [voices, setVoices] = useState([]);
  const [voiceId, setVoiceId] = useState(null);
  const [speakEnabled, setSpeakEnabled] = useState(true);

  // Refs for side-effectful systems
  const esRef = useRef(null);                        // EventSource
  const lastSeenTsRef = useRef(0);                   // last SSE ts processed
  const bufferRef = useRef('');                      // sentence buffer
  const lastMsgAtRef = useRef(0);                    // ms clock of last chunk
  const flushTimerRef = useRef(0);                   // silence timer id

  const ttsQueueRef = useRef([]);                    // [{text, voiceId}]
  const playingRef  = useRef(false);                 // is a clip currently playing
  const audioRef    = useRef(null);                  // single Audio()

  // keep the *current* voice in a ref so the SSE effect doesn’t depend on voiceId
  const voiceRef = useRef(null);
  useEffect(() => { voiceRef.current = voiceId; }, [voiceId]);

  // ---- Load voices once ----
  useEffect(() => {
    let alive = true;
    fetch('/api/voices')
      .then(r => r.json())
      .then(j => {
        if (!alive) return;
        const v = j?.voices || [];
        setVoices(v);
        if (v.length) setVoiceId(v[0].voice_id);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // ---- Connect SSE ONCE (voice changes won’t reconnect) ----
  useEffect(() => {
    if (!code) return;

    const es = new EventSource(`/api/stream?code=${encodeURIComponent(code)}`);
    esRef.current = es;

    const onChunk = (e) => {
      try {
        const msg = JSON.parse(e.data);   // { ts, en }
        if (!msg?.ts) return;
        if (msg.ts <= lastSeenTsRef.current) return; // ignore historical lines
        lastSeenTsRef.current = msg.ts;

        const spoken = (msg.en || '').trim();
        if (!spoken) return;

        // keep readable transcript
        setLines((prev) => [...prev, { ts: msg.ts, text: spoken }].slice(-300));

        // speech pipeline
        processSpoken(spoken);
      } catch {}
    };

    es.onmessage = onChunk;

    es.addEventListener('end', () => {
      es.close();
      flushNow(); // flush whatever remains as a final thought
    });

    return () => {
      es.close();
      esRef.current = null;
      clearTimeout(flushTimerRef.current);
      bufferRef.current = '';
      ttsQueueRef.current = [];
      playingRef.current  = false;
      if (audioRef.current) {
        try { audioRef.current.pause(); } catch {}
        audioRef.current = null;
      }
    };
    // IMPORTANT: do NOT include voiceId here, or we’ll reconnect + replay history
  }, [code, speakEnabled]);

  // ---- Process mic chunk text into a buffered "thought" ----
  function processSpoken(raw) {
    const now = Date.now();
    lastMsgAtRef.current = now;

    // discard fillers
    if (THROWAWAY.test(raw)) return;

    // merge “2, 3” etc. into previous clause
    if (NUMBERS_ONLY.test(raw)) {
      const cur = bufferRef.current.trim();
      if (cur) {
        bufferRef.current = (cur + ' ' + raw).replace(/\s+/g, ' ').trim();
      } else {
        bufferRef.current = raw.trim();
      }
    } else {
      bufferRef.current = (bufferRef.current + ' ' + raw).replace(/\s+/g, ' ').trim();
    }

    // (re)start a silence timer to flush after a gap
    clearTimeout(flushTimerRef.current);
    flushTimerRef.current = window.setTimeout(() => {
      // only flush if we truly had no new text during the gap
      if (Date.now() - lastMsgAtRef.current >= FLUSH_GAP_MS) {
        flushNow();
      }
    }, FLUSH_GAP_MS);

    // flush immediately if sentence-like end, or phrase is long, or soft-ender
    if (TERMINATORS.test(bufferRef.current) ||
        bufferRef.current.length >= MAX_PHRASE_LEN ||
        endsWithSoftEnder(bufferRef.current)) {
      flushNow();
    }
  }

  function endsWithSoftEnder(s) {
    const t = s.toLowerCase().trim().replace(/[.?!…]+$/, '');
    return SOFT_ENDERS.some(end => t.endsWith(end));
  }

  function flushNow() {
    clearTimeout(flushTimerRef.current);
    const text = finalize(bufferRef.current);
    bufferRef.current = '';
    if (!text) return;
    if (speakEnabled) enqueueTTS(text, voiceRef.current);
  }

  // normalize sentence: punctuation spacing, ensure an ending dot
  function finalize(s) {
    let out = (s || '').replace(/\s+/g, ' ').trim();
    if (!out) return '';
    out = out.replace(/\s*,\s*/g, ', ').replace(/\s+([.!?…])/g, '$1');
    if (!TERMINATORS.test(out)) out += '.';
    return out;
  }

  /** ---------- TTS queue: strict one-at-a-time playback ---------- */
  function enqueueTTS(text, vid) {
    if (!text?.trim() || !vid) return;
    const q = ttsQueueRef.current;
    if (q.length && q[q.length - 1].text === text) return; // drop immediate dup
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
        body: JSON.stringify({ text, voiceId: vid, modelId: 'eleven_flash_v2_5' }),
      });
      if (!res.ok) throw new Error('TTS failed');
      const ab = await res.arrayBuffer();
      const blob = new Blob([ab], { type: 'audio/mpeg' });

      if (!audioRef.current) audioRef.current = new Audio();
      const a = audioRef.current;
      a.src = URL.createObjectURL(blob);

      await a.play().catch(() => {});
      await waitForEnd(a);
    } catch {
      // swallow & continue
    } finally {
      playNext();
    }
  }

  function waitForEnd(audio) {
    return new Promise((resolve) => {
      const done = () => { audio.removeEventListener('ended', done); resolve(); };
      audio.addEventListener('ended', done, { once: true });
    });
  }

  // If user disables Speak, clear pending audio immediately
  useEffect(() => {
    if (!speakEnabled) {
      ttsQueueRef.current = [];
      if (audioRef.current) {
        try { audioRef.current.pause(); } catch {}
      }
      playingRef.current = false;
    }
  }, [speakEnabled]);

  const rendered = useMemo(() => lines, [lines]);

  /** ---------------- UI ---------------- */
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
