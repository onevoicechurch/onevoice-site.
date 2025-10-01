import { Redis } from '@upstash/redis';

export const kv = new Redis({
  url: process.env.onevoice_KV_REST_API_URL,
  token: process.env.onevoice_KV_REST_API_TOKEN,
});

export function evKey(code)   { return `onevoice:events:${code}` }  // list of transcript events
export function auKey(code)   { return `onevoice:audio:${code}` }   // list of base64 audio chunks
export function ssKey(code)   { return `onevoice:session:${code}` } // hash: { createdAt, inputLang }
