'use client';
import { useEffect, useState } from 'react';

export default function ListenerPage({ params }) {
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [speakEnabled, setSpeakEnabled] = useState(true);

  // Load available voices from our backend API
  useEffect(() => {
    fetch('/api/voices')
      .then((res) => res.json())
      .then((data) => {
        setVoices(data.voices || []);
        if (data.voices?.length) {
          setSelectedVoice(data.voices[0].voice_id);
        }
      });
  }, []);

  async function playTTS(text) {
    if (!speakEnabled || !selectedVoice) return;

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voiceId: selectedVoice,
          modelId: 'eleven_flash_v2_5', // use Flash for cheaper, real-time TTS
        }),
      });

      if (!res.ok) throw new Error('TTS request failed');

      const audioBuffer = await res.arrayBuffer();
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const decoded = await audioCtx.decodeAudioData(audioBuffer);
      const source = audioCtx.createBufferSource();
      source.buffer = decoded;
      source.connect(audioCtx.destination);
      source.start(0);
    } catch (err) {
      console.error('TTS error', err);
    }
  }

  return (
    <div className="p-6 text-white">
      <h1 className="text-xl font-bold mb-4">OneVoice — Live Captions</h1>

      <label className="mr-2">Voice:</label>
      <select
        value={selectedVoice || ''}
        onChange={(e) => setSelectedVoice(e.target.value)}
        className="text-black p-1 rounded"
      >
        {voices.map((v) => (
          <option key={v.voice_id} value={v.voice_id}>
            {v.name}
          </option>
        ))}
      </select>

      <label className="ml-4">
        <input
          type="checkbox"
          checked={speakEnabled}
          onChange={() => setSpeakEnabled(!speakEnabled)}
          className="mr-1"
        />
        Speak
      </label>

      <div id="captions" className="mt-6 p-4 bg-black/40 rounded">
        {/* TODO: plug in your websocket/subscription feed here so every line of translated text calls playTTS */}
        <p className="opacity-50">Waiting for captions…</p>
      </div>
    </div>
  );
}
