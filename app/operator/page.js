'use client';
import { useState, useRef } from 'react';

export default function OperatorPage() {
  const [code, setCode] = useState<string | null>(null);
  const [inputLang, setInputLang] = useState('AUTO');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<any[]>([]);

  const mediaRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);

  async function startSession() {
    try {
      setLog([]);
      setRunning(true);
      setCode(Math.random().toString(36).substring(2, 6).toUpperCase());
      setLog(l => [...l, { text: 'Session ready', time: new Date() }]);
    } catch (e: any) {
      setRunning(false);
      setLog(l => [...l, { text: 'Session error', time: new Date() }]);
      console.error('session error', e);
    }
  }

  function endSession() {
    setRunning(false);
    setCode(null);
    setLog(l => [...l, { text: 'Session ended', time: new Date() }]);
  }

  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <h2>🎙️ Operator Console (Whisper)</h2>
      <div style={{ marginBottom: 12 }}>
        <strong>Access Code:</strong> {code || '----'}{' '}
        <button onClick={startSession} disabled={running}>
          New Session
        </button>{' '}
        <button onClick={endSession} disabled={!running}>
          End Session
        </button>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label>Input language: </label>
        <select
          value={inputLang}
          onChange={e => setInputLang(e.target.value)}
          disabled={running}
        >
          <option value="AUTO">Auto-detect</option>
          <option value="en">English</option>
          <option value="es">Spanish</option>
          <option value="vi">Vietnamese</option>
          <option value="zh">Chinese</option>
        </select>
      </div>
      <h3>Live Preview (spoken text)</h3>
      <div
        style={{
          background: '#0b1c2c',
          color: '#fff',
          padding: 10,
          borderRadius: 6,
          minHeight: 120,
        }}
      >
        {log.map((entry, i) => (
          <div key={i}>
            🗣️ {new Date(entry.time).toLocaleTimeString()} — {entry.text}
          </div>
        ))}
      </div>
    </div>
  );
}
