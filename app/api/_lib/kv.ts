import { Redis } from '@upstash/redis';
const kv = Redis.fromEnv();

async function appendLog(code, line) {
  if (!code) return;
  await kv.rpush(`onevoice:log:${code}`, { t: Date.now(), text: line });
}

export { kv, appendLog };
