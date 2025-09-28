import { NextResponse } from "next/server";
import { attachListener, detachListener, getSession } from "../_lib/sessionStore";

export const runtime = "edge";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code || !getSession(code)) {
    return new NextResponse("No such session", { status: 404 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const res = {
        write: (chunk) => controller.enqueue(new TextEncoder().encode(chunk)),
        end: () => controller.close(),
        flush: () => {},
      };
      if (!attachListener(code, res)) {
        controller.close();
        return;
      }
      const hb = setInterval(() => res.write(`: ping\n\n`), 15000);
      controller._cleanup = () => {
        clearInterval(hb);
        detachListener(code, res);
      };
    },
    cancel() { this._cleanup?.(); }
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    }
  });
}
