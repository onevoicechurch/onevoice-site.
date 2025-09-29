import { getSession, attachListener, detachListener } from "../_lib/sessionStore";

export async function GET(req) {
  const searchParams = new URL(req.url).searchParams;
  const code = searchParams.get("code");

  const session = getSession(code);
  if (!code || !session) {
    return new Response(JSON.stringify({ ok: false, error: "No such session" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
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
      },
      cancel() {
        detachListener(code);
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
