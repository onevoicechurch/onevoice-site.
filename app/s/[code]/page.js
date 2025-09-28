"use client";
import { useEffect, useMemo, useState } from "react";

export default function Listener({ params, searchParams }) {
  const initialLang = typeof window !== "undefined"
    ? (new URLSearchParams(window.location.search).get("lang") || "es")
    : "es";

  const [lang, setLang] = useState(initialLang);
  const [lines, setLines] = useState([]);

  useEffect(() => {
    const es = new EventSource(`/api/stream?code=${params.code}`);
    es.onmessage = async (e) => {
      const line = JSON.parse(e.data);
      // If the operator’s default targetLang isn't the same as the listener’s,
      // we still show the line now (for v1). In a next pass we’ll request a per-listener translation.
      setLines((prev) => [...prev, line].slice(-200));
    };
    es.addEventListener("end", () => es.close());
    return () => es.close();
  }, [params.code]);

  return (
    <div style={{ maxWidth: 800, margin: "40px auto", fontSize: 20 }}>
      <h1>🛜 OneVoice — Live Captions</h1>
      <div style={{ marginBottom: 12 }}>
        Code: <strong>{params.code}</strong>
      </div>
      <div style={{ marginBottom: 16 }}>
        My language:
        {" "}
        <select value={lang} onChange={(e) => setLang(e.target.value)}>
          <option value="es">Spanish</option>
          <option value="pt">Portuguese</option>
          <option value="fr">French</option>
          <option value="de">German</option>
          <option value="zh">Chinese</option>
          <option value="ar">Arabic</option>
          <option value="vi">Vietnamese</option>
        </select>
        <span style={{ opacity: 0.6, marginLeft: 8 }}>
          (v1 shows operator’s translated lines; per-listener language is next)
        </span>
      </div>

      <div style={{
        background: "#0b1220",
        color: "#fff",
        padding: 16,
        borderRadius: 12,
        minHeight: 240,
        lineHeight: 1.6
      }}>
        {lines.map((l) => (
          <div key={l.ts} style={{ marginBottom: 10 }}>
            {l.translated}
          </div>
        ))}
      </div>
    </div>
  );
}
