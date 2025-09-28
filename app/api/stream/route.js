import { NextResponse } from "next/server";
import { attachListener, detachListener, getSession } from "../_lib/sessionStore";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code || !getSession(code)) {
    return new NextResponse("No such session", { status: 404 });
  }

  const stream = new ReadableStream({
    start(controller) {
      // @ts-ignore
      const res = {
        write: (chunk) => controller.enqueue(new TextEncoder().encode(chunk)),
        end: () => controller.close(),
        flush: () => {},
      };
      // Attach as listener
      if (!attachListener(code, res)) {
        controller.close();
        return;
      }
      // Heartbeat so proxies keep connection alive
      const iv = setInterval(() => res.write(`: ping\n\n`), 15000);

      // When client disconnects
      // @ts-ignore
      controller._onClose = () => {
        clearInterval(iv);
        detachListener(code, res);
      };
    },
    cancel(reason) {
      // When browser closes
      this._onClose?.();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
