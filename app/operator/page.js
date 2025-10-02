// ...inside startMic()

// choose a Deepgram-friendly codec order (ogg/opus tends to be very solid)
let mime = "audio/ogg;codecs=opus";
if (!MediaRecorder.isTypeSupported(mime)) mime = "audio/webm;codecs=opus";
if (!MediaRecorder.isTypeSupported(mime)) mime = "audio/webm";
if (!MediaRecorder.isTypeSupported(mime)) mime = "audio/mpeg"; // last resort

const mr = new MediaRecorder(stream, { mimeType: mime });
recRef.current = { mr, ctx };

mr.ondataavailable = async (ev) => {
  if (!ev.data || ev.data.size === 0) return;
  lastChunkAtRef.current = Date.now();

  const form = new FormData();
  form.append("audio", ev.data, ev.data.type.includes("ogg") ? "chunk.ogg" :
                               ev.data.type.includes("mp3") ? "chunk.mp3" : "chunk.webm");
  form.append("code", current);
  form.append("lang", inputLang === "AUTO" ? "" : inputLang);
  form.append("mime", ev.data.type || mime); // <— tell server what we actually recorded

  await fetch("/api/ingest", { method: "POST", body: form }).catch(() => {});
};

mr.start(1000); // ~1s chunks
