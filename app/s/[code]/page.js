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
         
