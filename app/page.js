import Link from "next/link";

const bg = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  background: "linear-gradient(135deg, #0e1a2b 0%, #153a74 60%, #0f3070 100%)",
  color: "white"
};

export default function Home() {
  return (
    <main style={bg}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "48px", marginBottom: "12px" }}>Welcome to OneVoice 🎤</h1>
        <p style={{ opacity: 0.9, marginBottom: "24px" }}>
          Real-time translation built for churches.
        </p>
        <Link
          href="/translate"
          style={{
            background: "white",
            color: "#0e1a2b",
            padding: "12px 20px",
            borderRadius: "10px",
            fontWeight: 700,
            textDecoration: "none"
          }}
        >
          Try the Translator
        </Link>
      </div>
    </main>
  );
}
