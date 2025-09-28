// app/layout.js

export const metadata = {
  title: "OneVoice",
  description: "Real-time church translation platform",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
