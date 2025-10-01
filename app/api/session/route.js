export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createSession, endSession, setInputLang } from '../_lib/sessionStore';

export async function POST(req) {
  const body = await req.json().catch(()=> ({}));
  const inputLang = body?.inputLang || 'AUTO';
  const code = await createSession(inputLang);
  return NextResponse.json({ ok: true, code });
}

export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  if (!code) return NextResponse.json({ ok:false, error:'Missing code' }, { status:400 });
  await endSession(code);
  return NextResponse.json({ ok:true });
}

export async function PATCH(req){
  const body = await req.json().catch(()=> ({}));
  const { code, inputLang } = body || {};
  if (!code || !inputLang) return NextResponse.json({ ok:false, error:'Missing code/inputLang' }, { status:400 });
  await setInputLang(code, inputLang);
  return NextResponse.json({ ok:true });
}
