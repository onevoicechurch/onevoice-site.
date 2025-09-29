import { NextResponse } from "next/server";
import { getSession, attachListener, detachListener } from "../_lib/sessionStore";

export async function GET(req) {
  const code = new URL(req.url).searchParams.get("code");
  if (!code || !getSession(code)) {
    return NextResponse.json({ ok: false, error: "No such session" }, { status: 404 });
  }

  return new Response(
    new ReadableStream({
      start(controller) {
        const res = {
          write: (chunk) => controller.enqueue(new TextEncoder().encode(chunk)),
          flush: () => {},
          end: () => controller.close(),
        };
        attachListener(code, res);
        // keep a reference so we can detach on cancel
        this._listener = res;
      },
      cancel: () => {
        if (this._listener) detachListener(code, this._listener);
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    }
  );
}
