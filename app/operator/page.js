"use client";
import { useEffect, useRef, useState } from "react";

export default function Operator() {
  const [code, setCode] = useState("");
  const [running, setRunning] = useState(false);
  const [targetLang, setTargetLang] = useState("es");
  const [log, setLog] = useState([]);
  const mediaRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  // Pull the live feed so the operator sees what listeners see
  useEffect(() => {
    if (!code) return;
    const es = new EventSource(`/api/stream?code=${code}`);
    es.onmessage = (e) => {
      const line = JSON.parse(e.data);
      setLog((prev) => [...prev, line].slice(-100));
    };
    es.addEventListener("end", () => es.close());
    return () => es.close();
  }, [code]);

  async function startSession() {
    const res = await fetch("/api/session", { method: "POST" });
    const data = await res.json();
    setCode(data.code);
  }

  async function endSession() {
    if (!code) return;
    await fetch(`/api/session?code=${code}`, { method: "DELETE" });
    stopMic();
    setRunning(false);
    setCode("");
    setLog([]);
  }

  async function startMic() {
    if (!code) {
      alert("Start a session first.");
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRef.current = stream;

    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    recorderRef.current = recorder;

    recorder.ondataavailable = async (e) => {
      if (!e.data || e.data.size < 2000) return; // ignore tiny slivers
      try {
        const blob = e.data;
        const buf = await blob.arrayBuffer();
        await fetch(`/api/ingest?code=${code}&lang=${targetLang}`, {
          method: "POST",
          headers: { "Content-Type": blob.type || "audio/webm" },
          body: buf,
        });
      } catch (err) {
        console.error("upload error", err);
      }
    };

    // push 1 chunk per second
    recorder.start(1000);
    setRunning(true);
  }

  function stopMic() {
    recorderRef.current?.stop();
    mediaRef.current?.getTracks().forEach(t => t.stop());
    setRunning(false);
  }

  return (
    <div style={{ maxWidth: 800, margin: "40px auto" }}>
      <h1>🎚️ Operator Console</h1>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={startSession} disabled={!!code}>Start Session</button>
        <button onClick={endSession} disabled={!code}>End Session</button>

        <label>
          Target language{" "}
          <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
            <option value="es">Spanish</option>
            <option value="pt">Portuguese</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="zh">Chinese</option>
            <option value="ar">Arabic</option>
            <option value="vi">Vietnamese</option>
          </select>
        </label>

        <button onClick={startMic} disabled={!code || running}>🎙️ Mic ON</button>
        <button onClick={stopMic} disabled={!running}>⏹️ Mic OFF</button>
      </div>

      <div style={{ marginTop: 16 }}>
        <strong>Access Code:</strong>{" "}
        <span style={{ fontSize: 24 }}>{code || "—"}</span>
      </div>

      <hr style={{ margin: "24px 0" }} />

      <h3>Live Feed</h3>
      <div style={{ background: "#111", color: "#fff", padding: 12, borderRadius: 8, minHeight: 160 }}>
        {log.map((l) => (
          <div key={l.ts} style={{ marginBottom: 8 }}>
            <div style={{ opacity: 0.6, fontSize: 12 }}>{new Date(l.ts).toLocaleTimeString()}</div>
            <div>🗣️ {l.text}</div>
            <div>🌍 {l.translated}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
