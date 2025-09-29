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

// ====== TUNING KNOBS (adjust these to taste) ======
const VAD_CHECK_MS = 100;      // how often we sample loudness
const PAUSE_MS = 900;          // how long of silence ends an utterance
const MAX_UTTER_MS = 8000;     // hard cap per utterance (flush even if still speaking)
const ENERGY_THRESHOLD = 0.01; // speaking vs silence threshold (0.003–0.02 typical)
const MIN_BLOB_BYTES = 8000;   // ignore blobs smaller than this (usually invalid)
// ===================================================

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
  const pendingSinceFlushRef = useRef(false); // tracks if we have recorded since last send

  const siteOrigin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://onevoice.church';

  const listenerUrl = code ? `${siteOrigin}/s/${encodeURIComponent(code)}` : '#';
  const qrUrl = code
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
        listenerUrl
      )}`
    : '';

  // load prefs
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setCode(
      localStorage.getItem('ov:lastCode') ||
        Math.random().toString(36).slice(2, 6).toUpperCase()
    );
    setInputLang(localStorage.getItem('ov:inputLang') || 'AUTO');
    setLangsCsv(localStorage.getItem('ov:langs') || 'es,vi,zh');
  }, []);

  // persist prefs
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
    es.on
