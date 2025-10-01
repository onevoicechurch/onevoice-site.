// app/api/ingest/route.ts
import { NextResponse } from "next/server";
import { kv } from "../_lib/kv";

export const runtime = "nodejs";

type IngestBody = {
  code?: string;
  text?: string;
  lang?: string;     // optional, ISO code like 'en', 'es', etc.
  final?: boolean;   // optional, mark this as a completed sentence/thought
};

const listKey = (code: string) => `onevoice:log:${code}`;
const metaKey = (code: string) => `onevoice:meta:${code}`;

export async function POST(req: Request) {
  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
  }

  const raw = (body.text ?? "").trim();
  const code = (body.code ?? "").toUpperCase();

  if (!code) return NextResponse.json({ ok: false, error: "MISSING_CODE" }, { status: 400 });
  if (!raw)  return NextResponse.json({ ok: false, error: "EMPTY_TEXT" }, { status: 400 });

  // Create an ordered, append-only item
  const item = {
    id: Date.now(),          // sortable timestamp
    text: raw,
    lang: body.lang || null, // optional language tag
    final: Boolean(body.final),
  };

  // Append to the end (preserves natural order)
  await kv.rpush(listKey(code), JSON.stringify(item));

  // Touch metadata (handy for dashboards/health)
  await kv.hset(metaKey(code), {
    lastAt: item.id.toString(),
    lastLang: item.lang ?? "",
  });

  return NextResponse.json({ ok: true });
}
