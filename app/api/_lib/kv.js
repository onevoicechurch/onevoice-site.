import { Redis } from "@upstash/redis";

// Uses UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN from Vercel env
const kv = Redis.fromEnv();

async function appendLog(code, line) {
  if (!code) return;
  await kv.rpush(`onevoice:log:${code}`, { t: Date.now(), text: line });
}

export { kv, appendLog };
