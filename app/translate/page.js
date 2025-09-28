"use client";
import { useState } from "react";

const pageStyle = {
  minHeight: "100vh",
  background: "linear-gradient(135deg, #0e1a2b 0%, #153a74 60%, #0f3070 100%)",
  color: "white",
  padding: "40px"
};

export default function TranslatePage() {
  const [text, setText] = useState("");
  const [target, setTarget] = useState("Spanish");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");

  async function handleTranslate(e) {
    e.preventDefault();
    setLoading(true);
    setResult("");
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, target })
      });
      if (!res.ok) throw new Error("Translation failed");
      const data = await res.json();
      setResult(data.translation || "");
    } catch (err) {
      setResult("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={pageStyle}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ fontSize: 38, marginBottom: 8 }}>Text Translator (demo)</h1>
        <p style={{ opacity: 0.9, marginBottom: 24 }}>
          Type a few sentences. Choose a language. We’ll translate using OpenAI.
        </p>

        <form onSubmit={handleTranslate} style={{ display: "grid", gap: 12 }}>
          <textarea
            required
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type text in English..."
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 10,
              border: "none",
              outline: "none",
              fontSize: 16
            }}
          />
          <div style={{ display: "flex", gap: 12 }}>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              style={{
                padding: 12,
                borderRadius: 10,
                border: "none",
                outline: "none",
                fontSize: 16,
                color: "#0e1a2b"
              }}
            >
              <option>Spanish</option>
              <option>French</option>
              <option>Portuguese</option>
              <option>Vietnamese</option>
              <option>Chinese (Simplified)</option>
              <option>Arabic</option>
              <option>Hindi</option>
              <option>Korean</option>
              <option>Russian</option>
            </select>

            <button
              type="submit"
              disabled={loading}
              style={{
                background: "white",
                color: "#0e1a2b",
                padding: "12px 20px",
                borderRadius: 10,
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                opacity: loading ? 0.7 : 1
              }}
            >
              {loading ? "Translating..." : "Translate"}
            </button>
          </div>
        </form>

        {result && (
          <div
            style={{
              marginTop: 20,
              background: "rgba(255,255,255,0.1)",
              padding: 16,
              borderRadius: 10,
              whiteSpace: "pre-wrap"
            }}
          >
            <strong>Result:</strong>
            <div style={{ marginTop: 8 }}>{result}</div>
          </div>
        )}
      </div>
    </main>
  );
}
