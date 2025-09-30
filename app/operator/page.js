'use client';

import { useEffect, useRef, useState } from 'react';

// ---- Tunables --------------------------------------------------------------
const SEG_MS = 5000;                   // 5s chunks -> finalized files (no 400s)
const MIN_BYTES = 3500;                // drop tiny blobs (mobile quirks)
// ---------------------------------------------------------------------------

export default function OperatorPage() {
  // session + UI
  const [code, setCode]           = useState<string | null>(null);
  const [inputLang, setInputLang] = useState<string>('AUTO'); // 'AUTO' or BCP-47
  const [running, setRunning]     = useState(false);
  const [status, setStatus]       = useState<string>('Idle');
  const [log, setLog]             = useState<Array<{t:number, text:string}>>([]);

  // media
  const mediaRef  = useRef<MediaStream | null>(null);
  const recRef    = useRef<MediaRecorder | null>(null);
  const segTimer  = useRef<number | null>(null);

  // SSE -> live preview of spoken text only (no translations)
  const esRef     = useRef<EventSource | null>(null);

  // Create a session on first load (or when user clicks "New Session")
  useEffect(() => { createSession(); }, []);

  async function createSession() {
    try {
      const r = await fetch('/api/session', { method: 'POST' });
      const j = await r.json();
      if (!r.ok || !j?.code) throw new Error(j?.error || 'make session failed');
      setCode(j.code);
      setLog([]);
      setStatus('Session ready');
      reconnectSSE(j.code);
    } catch (e:any) {
      setStatus('Session error');
      console.error('session error', e);
    }
  }

  function reconnectSSE(c:string) {
    try { esRef.current?.close(); } catch {}
    const es = new EventSource(`/api/stream?code=${encodeURIComponent(c)}`);
    es.onmessage = (ev) => {
      try {
        const line = JSON.parse(ev.data); // { role:'mic'|'out', text:'...' }
        if (!line?.text) return;
        // only show spoken text (input stream)
        setLog((prev) => [...prev, { t: Date.now(), text: line.text }]);
      } catch {}
    };
    es.onerror = () => { /* keep it quiet; server closes on end */ };
    esRef.current = es;
  }

  // -------- Mic control with continuous 5s chunks ---------------------------
  async function startMic() {
    if (!code) return;
    // ask for mic
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    mediaRef.current = stream;
    setRunning(true);
    setStatus('Mic running');

    // pick a very compatible container
    const mimeType =
      MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
      MediaRecorder.isTypeSupported('audio/webm')                ? 'audio/webm' :
      MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')   ? 'audio/ogg;codecs=opus' :
      '';

    const loop = () => {
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recRef.current = rec;

      rec.ondataavailable = async (e: BlobEvent) => {
        if (!e.data || e.data.size < MIN_BYTES) return;
        try {
          const ab = await e.data.arrayBuffer();
          const ct = e.data.type || (mimeType.includes('ogg') ? 'audio/ogg' : 'audio/webm');

          const qs = new URLSearchParams({
            code,
            inputLang,
            ts: String(Date.now()),
          });

          const r = await fetch('/api/ingest?' + qs.toString(), {
            method: 'POST',
            headers: { 'Content-Type': ct },
            body: ab,
          });

          if (!r.ok) {
            const txt = await r.text().catch(()=>'');
            console.warn('ingest failed', r.status, txt);
            setStatus('Ingest error ' + r.status);
          } else {
            setStatus('Chunk processed');
          }
        } catch (err) {
          console.error('ingest send error', err);
          setStatus('Network error');
        }
      };

      rec.onstart = () => {
        // stop in SEG_MS so the container finalizes; then onstop restarts
        if (segTimer.current) window.clearTimeout(segTimer.current);
        segTimer.current = window.setTimeout(() => {
          try { rec.state !== 'inactive' && rec.stop(); } catch {}
        }, SEG_MS) as unknown as number;
      };

      rec.onstop = () => {
        if (segTimer.current) window.clearTimeout(segTimer.current);
        if (running && mediaRef.current) loop(); // immediately start next segment
      };

      rec.start(); // no timeslice; we call stop() ourselves
    };

    loop();
  }

  function stopMic() {
    setRunning(false);
    setStatus('Mic off');
    try { if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop(); } catch {}
    if (segTimer.current) window.clearTimeout(segTimer.current);
    if (mediaRef.current) {
      mediaRef.current.getTracks().forEach(t => t.stop());
      mediaRef.current = null;
    }
  }

  // --------- Helpers --------------------------------------------------------
  function openListener() {
    if (!code) return;
    const url = `${location.origin}/s/${code}`;
    window.open(url, '_blank', 'noopener');
  }

  const listenerURL = code ? `${location.origin}/s/${code}` : '';
  const qrURL = code
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(listenerURL)}`
    : '';

  // --------- UI (restored look) --------------------------------------------
  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-900 to-blue-900 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex items-center gap-3 text-2xl font-semibold">
          <span className="text-3xl">🎙️</span>
          <h1>Operator Console (Whisper)</h1>
        </div>
        <p className="mt-1 text-slate-300">
          Share the code/QR. Pick input language (or Auto). Start the mic.
        </p>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-start">
          {/* Controls */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded bg-slate-800/70 px-3 py-1.5">
                <span className="mr-2 text-slate-400">Access Code</span>
                <span className="font-mono tracking-widest">{code ?? '----'}</span>
              </div>

              <button
                onClick={createSession}
                className="rounded bg-slate-700 hover:bg-slate-600 px-3 py-1.5 text-sm"
              >
                New Session
              </button>

              <button
                onClick={openListener}
                disabled={!code}
                className="rounded bg-slate-700 hover:bg-slate-600 px-3 py-1.5 text-sm disabled:opacity-40"
              >
                Open Listener
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm text-slate-300">Input language:</label>
              <select
                value={inputLang}
                onChange={(e) => setInputLang(e.target.value)}
                className="rounded bg-slate-800 px-2 py-1.5 text-sm outline-none"
              >
                <option value="AUTO">Auto-detect (Whisper)</option>
                <option value="en-US">English (United States)</option>
                <option value="es">Spanish</option>
                <option value="vi">Vietnamese</option>
                <option value="zh">Chinese</option>
                <option value="pt">Portuguese</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="ar">Arabic</option>
                <option value="hi">Hindi</option>
                {/* add more as you like; AUTO will still work for any */}
              </select>

              {running ? (
                <button
                  onClick={stopMic}
                  className="rounded bg-red-600 hover:bg-red-500 px-3 py-1.5 text-sm font-medium"
                >
                  ⏹️ Mic OFF
                </button>
              ) : (
                <button
                  onClick={startMic}
                  disabled={!code}
                  className="rounded bg-green-600 hover:bg-green-500 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
                >
                  🎤 Mic ON
                </button>
              )}

              <span className="text-sm text-slate-300">
                Status: <span className="font-medium text-slate-100">{status}</span>
              </span>
            </div>
          </div>

          {/* QR */}
          <div className="flex justify-center md:justify-end">
            <div className="rounded-lg bg-slate-800/60 p-3">
              {qrURL ? (
                <img
                  src={qrURL}
                  width={180}
                  height={180}
                  alt="Scan to open listener"
                  className="block"
                />
              ) : (
                <div className="w-[180px] h-[180px] grid place-items-center text-slate-400">
                  No code
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Live Preview (spoken text only) */}
        <div className="mt-6">
          <h2 className="mb-2 text-lg font-semibold">Live Preview (spoken text)</h2>
          <div className="rounded-xl bg-slate-900/70 p-4 shadow-inner ring-1 ring-slate-700">
            {log.length === 0 ? (
              <div className="h-48 grid place-items-center text-slate-400">
                Start the mic to see live text…
              </div>
            ) : (
              <div className="space-y-3 max-h-[50vh] overflow-auto">
                {log.map((l, i) => (
                  <div key={l.t + '-' + i} className="text-slate-100">
                    <span className="mr-2">🗣️</span>
                    <span className="text-sm opacity-60 mr-2">
                      {new Date(l.t).toLocaleTimeString()}
                    </span>
                    <span>{l.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-2 text-xs text-slate-400">
          Tip: keep this tab focused for best mic stability; Chrome preferred.
        </div>
      </div>
    </div>
  );
}
