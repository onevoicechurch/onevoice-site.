export const runtime = 'nodejs';

export async function GET() {
  const resp = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }
  });
  if (!resp.ok) return new Response('Failed to fetch voices', { status:502 });
  const data = await resp.json();
  const voices = (data?.voices || []).map(v => ({
    voice_id: v.voice_id,
    name: v.name,
    labels: v.labels || {}
  }));
  return Response.json({ voices });
}
