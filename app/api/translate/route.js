export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

export async function POST(req) {
  const { text, targetLang } = await req.json().catch(()=> ({}));
  if (!text || !targetLang) return NextResponse.json({ ok:false, error:'Missing text/targetLang' }, { status:400 });

  const sys = `You are a professional live interpreter. Translate into ${targetLang} with natural, conversational phrasing. Do not add comments.`;
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST',
    headers:{
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role:'system', content: sys },
        { role:'user', content: text }
      ]
    })
  });

  if (!resp.ok) {
    const t = await resp.text().catch(()=> '');
    return NextResponse.json({ ok:false, error:`openai-${resp.status}`, body:t }, { status:502 });
  }
  const data = await resp.json().catch(()=> ({}));
  const out = data?.choices?.[0]?.message?.content?.trim() || '';
  return NextResponse.json({ ok:true, text: out });
}
