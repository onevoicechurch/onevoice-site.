import { kv, ssKey, auKey, evKey } from './kv';

function randCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random()*alphabet.length)];
  return s;
}

export async function createSession(inputLang='AUTO') {
  let code;
  for (let tries=0; tries<10; tries++){
    code = randCode();
    const exists = await kv.exists(ssKey(code));
    if (!exists) break;
  }
  const now = Date.now();
  await kv.hset(ssKey(code), { createdAt: String(now), inputLang });
  await kv.del(auKey(code));
  await kv.del(evKey(code));
  return code;
}

export async function endSession(code) {
  await kv.del(auKey(code));
  await kv.del(evKey(code));
  await kv.del(ssKey(code));
}

export async function setInputLang(code, inputLang) {
  await kv.hset(ssKey(code), { inputLang });
}

export async function getInputLang(code) {
  const h = await kv.hgetall(ssKey(code));
  return h?.inputLang || 'AUTO';
}
