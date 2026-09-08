import { NextRequest } from "next/server";
import { createClient } from "redis";

export const dynamic = "force-dynamic";

// Only allow safe identifiers — prevents Redis channel injection
const FLOW_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

// Hard ceiling on SSE connection lifetime — prevents connections from leaking
// if the client never closes them (e.g. proxies that drop FIN silently)
const MAX_SSE_DURATION_MS = 30 * 60 * 1000; // 30 min

async function safeQuit(client: ReturnType<typeof createClient> | null) {
  if (!client) return;
  try { await client.quit(); } catch { /* best-effort */ }
}

export async function GET(req: NextRequest) {
  const flowId = req.nextUrl.searchParams.get("flowId");

  if (!flowId || !FLOW_ID_PATTERN.test(flowId)) {
    return new Response("Invalid or missing flowId", { status: 400 });
  }

  if (!process.env.REDIS_URL) {
    return new Response("Service unavailable", { status: 503 });
  }

  let subscriber: ReturnType<typeof createClient> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // Keepalive comment prevents proxy/load-balancer timeouts on idle flows
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);

      // Hard ceiling: close the stream after MAX_SSE_DURATION_MS regardless
      const maxDurationTimer = setTimeout(async () => {
        clearInterval(heartbeat);
        await safeQuit(subscriber);
        subscriber = null;
        try { controller.close(); } catch { /* already closed */ }
      }, MAX_SSE_DURATION_MS);

      const cleanup = async () => {
        clearInterval(heartbeat);
        clearTimeout(maxDurationTimer);
        const sub = subscriber;
        subscriber = null;
        try { await sub?.unsubscribe(`flow_updates:${flowId}`); } catch { /* */ }
        await safeQuit(sub);
        try { controller.close(); } catch { /* already closed */ }
      };

      try {
        subscriber = createClient({ url: process.env.REDIS_URL });
        await subscriber.connect();
      } catch {
        // subscriber.connect() failed — quit is safe to call (it's a no-op if not connected)
        await safeQuit(subscriber);
        subscriber = null;
        clearInterval(heartbeat);
        clearTimeout(maxDurationTimer);
        try { controller.close(); } catch { /* already closed */ }
        return;
      }

      try {
        await subscriber.subscribe(`flow_updates:${flowId}`, (message) => {
          try {
            controller.enqueue(encoder.encode(`data: ${message}\n\n`));
          } catch {
            // Stream already closed — trigger cleanup asynchronously
            cleanup().catch(() => {});
          }
        });
      } catch {
        // subscribe() failed after a successful connect — must quit the client
        await cleanup();
        return;
      }

      req.signal.addEventListener("abort", () => { cleanup().catch(() => {}); });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
