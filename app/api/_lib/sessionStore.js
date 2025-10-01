// app/api/_lib/sessionStore.ts
import { kvGet, kvSet, kvDel } from "./kv";

const PREFIX = "onevoice:session:";

export type Session = { code: string; createdAt: number };

export const newCode = () =>
  Math.random().toString(36).slice(2, 6).toUpperCase(); // e.g. “ABCD”

export const createSession = async (code: string) =>
  kvSet<Session>(PREFIX + code, { code, createdAt: Date.now() }, 60 * 60 * 6); // 6h TTL

export const getSession = async (code: string) =>
  kvGet<Session>(PREFIX + code);

export const endSession = async (code: string) =>
  kvDel(PREFIX + code);
