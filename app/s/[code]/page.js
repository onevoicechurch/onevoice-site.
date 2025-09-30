'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// 50-ish language options matching the keys generated on the server
const LANG_OPTIONS = [
  ['en','English'], ['es','Spanish'], ['vi','Vietnamese'], ['zh','Chinese (Simplified)'], ['zh-TW','Chinese (Traditional)'],
  ['ar','Arabic'], ['bg','Bulgarian'], ['ca','Catalan'], ['cs','Czech'], ['da','Danish'], ['de','German'], ['el','Greek'],
  ['et','Estonian'], ['fa','Persian'], ['fi','Finnish'], ['fr','French'], ['he','Hebrew'], ['hi','Hindi'], ['hr','Croatian'],
  ['hu','Hungarian'], ['id','Indonesian'], ['it','Italian'], ['ja','Japanese'], ['ko','Korean'], ['lt','Lithuanian'],
  ['lv','Latvian'], ['ms','Malay'], ['nl','Dutch'], ['no','Norwegian'], ['pl','Polish'], ['pt','Portuguese'],
  ['pt-BR','Portuguese (Brazil)'], ['ro','Romanian'], ['ru','Russian'], ['sk','Slovak'], ['sl','Slovenian'],
  ['sr','Serbian'], ['sv','Swedish'], ['sw','Swahili'], ['ta','Tamil'], ['th','Thai'], ['tr','Turkish'],
  ['uk','Ukrainian'], ['ur','Urdu'], ['af','Afrikaans'], ['bn','Bengali'], ['fil','Filipino'], ['gu','Gujarati'],
  ['kn','Kannada'], ['ml','Malayalam'], ['mr','Marathi']
];

const VOICE_CHOICES = ['Alloy','Samantha','Daniel','Victoria','Google español','Microsoft Sabina','Google हिन्दी','Google 日本語'];

export default function Listener({ params }) {
  const code = params.code;

  const [lang, setLang] = useState(() => localStorage.getItem('ov:viewerLang') || 'es');
  const [speak, setSpeak] = useState(() => localStorage.getItem('ov:speak') === '1');
  const [voiceName, setVoiceName] = useState(() => localStorage.getItem('ov:voiceName') || 'Alloy');
  const [lines, setLines] = useState([]);

  // speech
  const voicesRef = useRef([]);
  const utterQ = useRef([]); // queue of strings to speak
  const speakingRef = useRef(false);

  useEffect(() => { localStorage.setItem('ov:viewerLang', lang); }, [lang]);
  useEffect(() => { localStorage.setItem('ov:speak', speak ? '1' : '0'); }, [speak]);
  useEffect(() => { localStorage.setItem('ov:voiceName', voiceName); }, [voiceName]);

  // subscribe to server events
  useEffect(() => {
    const es = new EventSource(`/api/stream?code=${encodeURIComponent(code)}`);
    es.onmessage = (e) => {
      try {
        const line = JSON.parse(e.data);
        setLines((prev) => [...prev, line].slice(-200));
        if (speak) {
          const text = line.tx?.[lang] || line.en || '';
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

    // language hint (best effort)
    if (lang.startsWith('es')) u.lang = 'es-ES';
    else if (lang.startsWith('pt-BR')) u.lang = 'pt-BR';
    else if (lang.startsWith('pt')) u.lang = 'pt-PT';
    else if (lang.startsWith('vi')) u.lang = 'vi-VN';
    else if (lang.startsWith('zh-TW')) u.lang = 'zh-TW';
    else if (lang.startsWith('zh')) u.lang = 'zh-CN';
    else if (lang.startsWith('ja')) u.lang = 'ja-JP';
    else if (lang.startsWith('ko')) u.lang = 'ko-KR';
    else if (lang.startsWith('fr')) u.lang = 'fr-FR';
    else if (lang.startsWith('de')) u.lang = 'de-DE';
    else if (lang.startsWith('ar')) u.lang = 'ar-SA';

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
  const shown = latest ? (latest.tx?.[lang] || latest.en || '') : '';

  return (
    <main style={{ minHeight: '100vh', padding: 24, color: 'white', background: 'linear-gradient(135deg,#0e1a2b,#153a74 60%,#0f3070)' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <h1>OneVoice — Live Captions</h1>
        <div style={{ margin: '8px 0 16px', opacity: 0.9 }}>
          <span style={{ marginRight: 12 }}>Session: <code>{code}</code></span>
          <label style={{ marginRight: 8 }}>My language:{' '}
            <select value={lang} onChange={(e) => setLang(e.target.value)}>
              {LANG_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
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

        <div style={{ background: '#0b1220', borderRadius: 8, padding: 16, minHeight: 260, lineHeight: 1.6 }}>
          {lines.length === 0 ? (
            <div style={{ opacity: 0.7 }}>Waiting for captions…</div>
          ) : (
            <>
              <div style={{ fontSize: 22, marginBottom: 12 }}>{shown}</div>
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
