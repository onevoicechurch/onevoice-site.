// app/api/_lib/kv.ts
import { Redis } from "@upstash/redis";

// We’re using your custom env names from Vercel
const url   = process.env.onevoice_KV_REST_API_URL!;
const token = process.env.onevoice_KV_REST_API_TOKEN!;

if (!url || !token) {
  throw new Error("Upstash env vars missing: onevoice_KV_REST_API_URL / onevoice_KV_REST_API_TOKEN");
}

// Single Redis client
export const kv = new Redis({ url, token });

// Friendly helpers (and aliases so old imports won’t break)
export const kvGet = async <T = unknown>(key: string) => (await kv.get<T>(key)) ?? null;
export const kvSet = async <T = unknown>(key: string, value: T, ttlSec?: number) =>
  ttlSec ? kv.set(key, value as any, { ex: ttlSec }) : kv.set(key, value as any);
export const kvDel = async (key: string) => kv.del(key);

// Extra aliases in case some files import these names
export const get = kvGet;
export const set = kvSet;
export const del = kvDel;

export default kv;
