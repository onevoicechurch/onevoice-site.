'use client';
import { useEffect, useRef, useState } from 'react';

// 50ish common options (label -> target string sent to translator)
const LANGS = [
  ['Auto (original)', 'orig'],
  ['English', 'English'],
  ['Spanish', 'Spanish'],
  ['Portuguese (Brazil)', 'Portuguese (Brazil)'],
  ['French', 'French'],
  ['German', 'German'],
  ['Italian', 'Italian'],
  ['Dutch', 'Dutch'],
  ['Swedish', 'Swedish'],
  ['Norwegian', 'Norwegian'],
  ['Danish', 'Danish'],
  ['Finnish', 'Finnish'],
  ['Polish', 'Polish'],
  ['Czech', 'Czech'],
  ['Slovak', 'Slovak'],
  ['Romanian', 'Romanian'],
  ['Hungarian', 'Hungarian'],
  ['Greek', 'Greek'],
  ['Russian', 'Russian'],
  ['Ukrainian', 'Ukrainian'],
  ['Turkish', 'Turkish'],
  ['Arabic', 'Arabic'],
  ['Hebrew', 'Hebrew'],
  ['Persian (Farsi)', 'Persian'],
  ['Hindi', 'Hindi'],
  ['Urdu', 'Urdu'],
  ['Bengali', 'Bengali'],
  ['Tamil', 'Tamil'],
  ['Telugu', 'Telugu'],
  ['Malayalam', 'Malayalam'],
  ['Kannada', 'Kannada'],
  ['Marathi', 'Marathi'],
  ['Gujarati', 'Gujarati'],
  ['Punjabi', 'Punjabi'],
  ['Thai', 'Thai'],
  ['Vietnamese', 'Vietnamese'],
  ['Indonesian', 'Indonesian'],
  ['Malay', 'Malay'],
  ['Filipino (Tagalog)', 'Filipino'],
  ['Chinese (Simplified)', 'Chinese (Simplified)'],
  ['Chinese (Traditional)', 'Chinese (Traditional)'],
  ['Japanese', 'Japanese'],
  ['Korean', 'Korean'],
  ['Swahili', 'Swahili'],
  ['Amharic', 'Amharic'],
  ['Yoruba', 'Yoruba'],
  ['Igbo', 'Igbo'],
  ['Zulu', 'Zulu'],
  ['Xhosa', 'Xhosa'],
  ['Haitian Creole', 'Haitian Creole'],
];

export default function ListenerPage({ params }) {
  const code = (params?.code || '').toString().toUpperCase();
  const [lang, setLang] = useState('orig');
  const [log, setLog] = useState([]);                // source lines
  const [view, setView] = useState([]);              // rendered lines (translated or original)
  const cursorRef = useRef(0);
  const cache = useRef(new Map());                   // key: `${ts}|${lang}` -> translated text

  // poll source lines
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/stream?code=${code}&since=${cursorRef.current}`, { cache: 'no-store' });
        const j = await r.json();
        if (j?.items?.length) {
          cursorRef.current = j.next ?? cursorRef.current;
          setLog(prev => [...prev, ...j.items]);
        }
      } catch {}
    }, 900);
    return () => clearInterval(id);
  }, [code]);

  // translate new lines (or show originals)
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (lang === 'orig') {
        setView(log);
        return;
      }
      const work = [];
      const next = [];

      for (const item of log) {
        const key = `${item.ts}|${lang}`;
        const fromCache = cache.current.get(key);
        if (fromCache) {
          next.push({ ts: item.ts, text: fromCache });
        } else {
          work.push(
            fetch('/api/translate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: item.text, target: lang }),
            })
            .then(r => r.json())
            .then(j => {
              const out = (j?.text || item.text);
              cache.current.set(key, out);
              return { ts: item.ts, text: out };
            })
            .catch(() => ({ ts: item.ts, text: item.text }))
          );
        }
      }

      if (work.length) {
        const fresh = await Promise.all(work);
        if (!cancelled) {
          // merge: prefer translated entries where available
          const map = new Map(next.map(x => [x.ts, x.text]));
          for (const f of fresh) map.set(f.ts, f.text);
          const merged = log.map(x => ({ ts: x.ts, text: map.get(x.ts) || x.text }));
          setView(merged);
        }
      } else {
        setView(next.length ? next : log);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [log, lang]);

  return (
    <div style={{ maxWidth: 900, margin: '40px auto', padding: 12 }}>
      <h1>OneVoice — Live Captions</h1>

      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
        <div>Session: <b>{code}</b></div>
        <div>
          My language:&nbsp;
          <select value={lang} onChange={e => setLang(e.target.value)}>
            {LANGS.map(([label, value]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </div>

      <div style={{ background:'#0f172a', color:'#e2e8f0', padding:'14px 16px', borderRadius:10, marginTop:12 }}>
        {view.length === 0 && <div>Waiting for speech…</div>}
        {view.map((item, i) => (
          <div key={i} style={{ padding:'4px 0' }}>
            <span style={{ opacity:.6, marginRight:8 }}>{new Date(item.ts).toLocaleTimeString()}</span>
            <span>🌍 {item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
