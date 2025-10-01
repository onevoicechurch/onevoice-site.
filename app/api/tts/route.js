export const runtime = 'nodejs';

export async function POST(req) {
  const { text, voiceId } = await req.json().catch(()=> ({}));
  if (!text || !voiceId) return new Response('Missing text/voiceId', { status:400 });

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg'
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_flash_v2_5',           // low-latency good-enough
      voice_settings: { stability: 0.5, similarity_boost: 0.7 }
    })
  });

  if (!resp.ok) {
    const t = await resp.text().catch(()=> '');
    return new Response(`TTS failed ${resp.status}: ${t}`, { status:502 });
  }

  // Pass through audio/mpeg
  return new Response(resp.body, {
    headers: { 'Content-Type': 'audio/mpeg' }
  });
}
