'use client';

import { useEffect, useRef, useState } from 'react';

const LANGS = [
  { v:'en', label:'English' },
  { v:'es', label:'Spanish' },
  { v:'pt', label:'Portuguese' },
  { v:'fr', label:'French' },
  { v:'de', label:'German' }
];

export default function Listener({ params }) {
  const code = params.code;
  const [myLang, setMyLang] = useState('es'); // default to Spanish as example
  const [speak, setSpeak]   = useState(true);
  const [voice, setVoice]   = useState(null);
  const [voices, setVoices] = useState([]);
  const [lines, setLines]   = useState([]);

  const sseRef = useRef(null);
  const audioQueueRef = useRef([]); // { blobUrl }
  const playingRef = useRef(false);

  function pushLine(text) {
    setLines(prev => [{ ts: Date.now(), text }, ...prev].slice(0,200));
  }

  useEffect(()=>{
    fetch('/api/voices').then(r=>r.json()).then(d=>{
      setVoices(d?.voices || []);
      if (d?.voices?.length) setVoice(d.voices[0].voice_id);
    });
  }, []);

  function speakNext() {
    if (playingRef.current) return;
    const item = audioQueueRef.current.shift();
    if (!item) return;
    playingRef.current = true;
    const audio = new Audio(item.blobUrl);
    audio.onended = () => {
      playingRef.current = false;
      URL.revokeObjectURL(item.blobUrl);
      speakNext();
    };
    audio.play().catch(()=> {
      playingRef.current = false;
      // user interaction may be required to start audio; ignore
    });
  }

  async function handleTranscriptEvent(text) {
    // Translate for captions
    const tr = await fetch('/api/translate', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ text, targetLang: myLang })
    }).then(r=>r.json()).catch(()=> ({}));
    const translated = tr?.text || text;
    pushLine(translated);

    if (speak && voice) {
      // get audio from ElevenLabs
      const tts = await fetch('/api/tts', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ text: translated, voiceId: voice })
      });
      if (tts.ok) {
        const buf = await tts.arrayBuffer();
        const blobUrl = URL.createObjectURL(new Blob([buf], { type:'audio/mpeg' }));
        audioQueueRef.current.push({ blobUrl });
        speakNext();
      }
    }
  }

  useEffect(()=>{
    if (sseRef.current) sseRef.current.close();
    const es = new EventSource(`/api/stream?code=${code}`);
    sseRef.current = es;
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'transcript' && msg.text) {
          handleTranscriptEvent(msg.text);
        }
      } catch {}
    };
    es.onerror = () => {
      es.close();
      setTimeout(()=> {
        const neo = new EventSource(`/api/stream?code=${code}`);
        sseRef.current = neo;
      }, 1000);
    };
    return ()=> es.close();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, myLang, voice, speak]);

  return (
    <div style={{ padding:'24px', maxWidth:1000, margin:'0 auto', fontFamily:'system-ui, sans-serif' }}>
      <h1 style={{ fontSize:28, marginBottom:12 }}>OneVoice — Live Captions</h1>
      <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap', marginBottom:12 }}>
        <div><b>Session:</b> {code}</div>
        <div>
          <label>My language:&nbsp;</label>
          <select value={myLang} onChange={e=>setMyLang(e.target.value)}>
            {LANGS.map(l => <option key={l.v} value={l.v}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label><input type="checkbox" checked={speak} onChange={e=>setSpeak(e.target.checked)} /> Speak</label>
        </div>
        <div>
          <label>Voice:&nbsp;</label>
          <select value={voice || ''} onChange={e=>setVoice(e.target.value)}>
            {voices.map(v => <option key={v.voice_id} value={v.voice_id}>{v.name}</option>)}
          </select>
        </div>
      </div>

      <div style={{ background:'#0f1820', color:'#dfe7ef', padding:16, borderRadius:8, minHeight:120 }}>
        {lines.map((r,i)=>(
          <div key={i} style={{ opacity:i?0.85:1 }}>
            <small>{new Date(r.ts).toLocaleTimeString()} — </small>{r.text}
          </div>
        ))}
      </div>
    </div>
  );
}
