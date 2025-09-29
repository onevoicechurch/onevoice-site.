'use client';

import { useEffect, useRef, useState } from 'react';

const INPUT_LANGS = [
  { code: 'AUTO', label: 'Auto-detect (Whisper)' },
  { code: 'en-US', label: 'English (United States)' },
  { code: 'en-GB', label: 'English (United Kingdom)' },
  { code: 'en-AU', label: 'English (Australia)' },
  { code: 'en-CA', label: 'English (Canada)' },
  { code: 'es-US', label: 'Spanish (United States)' },
  { code: 'es-ES', label: 'Spanish (Spain)' },
  { code: 'es-MX', label: 'Spanish (Mexico)' },
  { code: 'vi-VN', label: 'Vietnamese (Vietnam)' },
];

/** ===== TUNING (balanced defaults) =====
 * We send ~5s chunks so utterances are sentence-like.
 * VAD keeps us from spamming during silence.
 */
const CHUNK_MS = 5000;        // media recorder timeslice (~5s)
const VAD_CHECK_MS = 100;     // loudness sampling interval
const PAUSE_MS = 900;         // silence that ends an utterance
const ENERGY_THRESHOLD = 0.01; // lower = more sensitive (0.003–0.02 typical)
const MIN_BLOB_BYTES = 8000;  // ignore very small chunks

export default function Operator() {
  const [code, setCode] = useState(null);
  const [inputLang, setInputLang] = useState('AUTO');
  const [langsCsv, setLangsCsv] = useState('es,vi,zh');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);

  const mediaRef = useRef(null);
  const recRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const vadTimerRef = useRef(null);

  const speakingRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const utterStartAtRef = useRef(0);

  const siteOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'https://onevoice.church';

  const listenerUrl = code ? `${siteOrigin}/s/${encodeURIComponent(code)}` : '#';
  const qrUrl = code
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(listenerUrl)}`
    : '';

  // load + persist small prefs
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setCode(
      localStorage.getItem('ov:lastCode') ||
        Math.random().toString(36).slice(2, 6).toUpperCase()
    );
    setInputLang(localStorage.getItem('ov:inputLang') || 'AUTO');
    setLangsCsv(localStorage.getItem('ov:langs') || 'es,vi,zh');
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (code) localStorage.setItem('ov:lastCode', code);
    localStorage.setItem('ov:inputLang', inputLang);
    localStorage.setItem('ov:langs', langsCsv);
  }, [code, inputLang, langsCsv]);

  // live preview via SSE
  useEffect(() => {
    if (!code) return;
    const es = new EventSource(`/api/stream?code=${encodeURIComponent(code)}`);
    es.onmessage = (e) => {
      try {
        const line = JSON.parse(e.data);
        setLog((prev) => [...prev, line].slice(-200));
      } catch {}
    };
    es.addEventListener('end', () => es.close());
    return () => es.close();
  }, [code]);

  async function startSession() {
    const r = await fetch('/api/session', { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    if (j.code) setCode(j.code);
  }

  async function endSession() {
    if (!code) return;
    try { await fetch(`/api/session?code=${encodeURIComponent(code)}`, { method: 'DELETE' }); } catch {}
    stopMic();
    setLog([]);
  }

  async function startMic() {
    // Prefer a format the server expects; webm/opus is OK
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true },
      video: false,
    });
    mediaRef.current = stream;

    // Hook up analyser for simple VAD
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    analyserRef.current = analyser;

    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    recRef.current = rec;

    // VAD loop
    lastSpeechAtRef.current = Date.now();
    utterStartAtRef.current = Date.now();
    speakingRef.current = false;

    vadTimerRef.current = setInterval(() => {
      const buf = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const energy = Math.sqrt(sum / buf.length); // 0..~1
      const now = Date.now();

      if (energy > ENERGY_THRESHOLD) {
        speakingRef.current = true;
        lastSpeechAtRef.current = now;
        if (now - utterStartAtRef.current > 60000) {
          // guard: reset if an hour-long “utterance”
          utterStartAtRef.current = now;
        }
      } else {
        // silence
        if (speakingRef.current && now - lastSpeechAtRef.current > PAUSE_MS) {
          speakingRef.current = false;
          utterStartAtRef.current = now; // next chunk will begin a new utterance server-side
        }
      }
    }, VAD_CHECK_MS);

    rec.ondataavailable = async (e) => {
      // We only submit on each timeslice (5s). Skip tiny blobs.
      if (!e.data || e.data.size < MIN_BLOB_BYTES) return;

      try {
        const qs = new URLSearchParams({
          code: code || '',
          inputLang: inputLang || 'AUTO',
          langs: (langsCsv || 'es').replace(/\s+/g, ''),
        });
        const ab = await e.data.arrayBuffer();

        await fetch('/api/ingest?' + qs.toString(), {
          method: 'POST',
          headers: { 'Content-Type': e.data.type || 'audio/webm' },
          body: ab,
        });
      } catch (err) {
        console.error('ingest error', err);
      }
    };

    rec.start(CHUNK_MS); // emit ~5s chunks
    setRunning(true);
  }

  function stop
