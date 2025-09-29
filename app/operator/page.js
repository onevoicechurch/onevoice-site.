// add near your other tuning knobs
const SEG_MS = 5000; // record 5s segments (finalized files -> no 400s)

// replace your startMic() with this
async function startMic() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true },
    video: false,
  });
  mediaRef.current = stream;
  setRunning(true);

  // choose a very compatible mimeType
  const mimeType =
    MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
    MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
    MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' :
    '';

  let recorder;      // current MediaRecorder
  let segTimer = 0;  // timer id

  const startRecorder = () => {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    recorder.ondataavailable = async (e) => {
      // only runs after we STOP the recorder (finalized container)
      if (!e.data || e.data.size < 6000) return;

      try {
        const qs = new URLSearchParams({
          code: code || '',
          inputLang,
          langs: (langsCsv || 'es').replace(/\s+/g, ''),
        });
        const ab = await e.data.arrayBuffer();
        await fetch('/api/ingest?' + qs.toString(), {
          method: 'POST',
          headers: { 'Content-Type': e.data.type || 'audio/webm' },
          body: ab,
        });
      } catch (err) {
        console.error('ingest send error', err);
      }
    };

    recorder.onstart = () => {
      // stop after SEG_MS so the file is finalized, then immediately restart
      segTimer = window.setTimeout(() => {
        try { recorder.state !== 'inactive' && recorder.stop(); } catch {}
      }, SEG_MS);
    };

    recorder.onstop = () => {
      window.clearTimeout(segTimer);
      // schedule the next segment immediately while the mic keeps running
      if (running && mediaRef.current) startRecorder();
    };

    recorder.start(); // no timeslice => we will call stop() ourselves
    recRef.current = recorder;
  };

  startRecorder();
}

// replace your stopMic() with this
function stopMic() {
  setRunning(false);
  try { recRef.current && recRef.current.state !== 'inactive' && recRef.current.stop(); } catch {}
  if (mediaRef.current) {
    mediaRef.current.getTracks().forEach((t) => t.stop());
    mediaRef.current = null;
  }
}
