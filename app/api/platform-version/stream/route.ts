import { NextRequest } from "next/server";
import { getPlatformVersion } from "@/lib/platform-version";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const POLL_MS = 1000;
const HEARTBEAT_MS = 15000;

function event(name: string, data: unknown) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  const since = String(
    new URL(request.url).searchParams.get("since") || ""
  );

  let closed = false;
  let checking = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const close = () => {
    if (closed) return;
    closed = true;

    if (pollTimer) clearInterval(pollTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);

    try {
      controllerRef?.close();
    } catch {}
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;

      const send = (name: string, data: unknown) => {
        if (closed) return;

        try {
          controller.enqueue(
            encoder.encode(event(name, data))
          );
        } catch {
          close();
        }
      };

      const check = async () => {
        if (closed || checking) return;

        checking = true;

        try {
          const version = await getPlatformVersion();

          if (closed) return;

          if (since) {
            send(
              version !== since ? "platform-changed" : "ready",
              { version }
            );
          } else {
            send("ready", { version });
          }
        } catch {
          // Keep the stream alive. The browser reconnects if the
          // connection is actually lost.
        } finally {
          checking = false;
        }
      };

      request.signal.addEventListener("abort", close, { once: true });

      void check();

      pollTimer = setInterval(() => {
        void check();
      }, POLL_MS);

      heartbeatTimer = setInterval(() => {
        if (closed) return;

        try {
          controller.enqueue(
            encoder.encode(": heartbeat\n\n")
          );
        } catch {
          close();
        }
      }, HEARTBEAT_MS);
    },

    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
