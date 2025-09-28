'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

export default function Listener({ params }) {
  const { code } = params;
  const [lang, setLang] = useState(() => localStorage.getItem('ov:listenerLang') || 'es');
  const [lines, setLines] = useState([]);
  const endRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('ov:listenerLang', lang);
  }, [lang]);

  useEffect(() => {
    const es = new EventSource(`/api/stream?code=${code}`);
    es.onmessage = (e) => {
      const line = JSON.parse(e.data); // { ts, en, tx: {es:"..",vi:".."} }
      const text = line.tx?.[lang] || line.en || '';
      setLines((prev) => [...prev, { ts: line.ts, text }].slice(-300));
    };
    es.addEventListener('end', () => es.close());
    return () => es.close();
  }, [code, lang]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines.length]);

  return (
    <main style={{ minHeight: '100vh', padding: 24, color: 'white', background: 'linear-gradient(135deg,#0e1a2b,#153a74 60%,#0f3070)' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1>OneVoice — Live Captions</h1>
        <div style={{ opacity: 0.8, marginBottom: 10 }}>Session: <code>{code}</code></div>

        <label>
          My language:&nbsp;
          <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ padding: 8, borderRadius: 8, color: '#0e1a2b' }}>
            <option value="es">Spanish</option>
            <option value="vi">Vietnamese</option>
            <option value="zh">Chinese</option>
            <option value="pt">Portuguese</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="ar">Arabic</option>
            <option value="hi">Hindi</option>
            <option value="ko">Korean</option>
            <option value="ru">Russian</option>
          </select>
          <span style={{ opacity: 0.7, marginLeft: 8 }}>(saved on this device)</span>
        </label>

        <div style={{ background: '#0b1220', borderRadius: 12, padding: 16, marginTop: 16, minHeight: '60vh', lineHeight: 1.6 }}>
          {lines.length === 0 ? <div style={{ opacity: 0.7 }}>Waiting for the speaker…</div> :
            lines.map((l) => (<div key={l.ts} style={{ marginBottom: 10 }}>{l.text}</div>))}
          <div ref={endRef} />
        </div>
      </div>
    </main>
  );
}
