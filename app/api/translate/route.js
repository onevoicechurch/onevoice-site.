import OpenAI from "openai";

export const runtime = "edge"; // fast on Vercel

export async function POST(req) {
  try {
    const { text, target } = await req.json();

    if (!text || !target) {
      return new Response(JSON.stringify({ error: "Missing text or target" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Cost-friendly, good quality model
    const prompt = `Translate the following text into ${target}. 
Return only the translation, no extra commentary.\n\n"${text}"`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a precise church-friendly translator." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2
    });

    const translation =
      completion.choices?.[0]?.message?.content?.trim() || "";

    return new Response(JSON.stringify({ translation }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
