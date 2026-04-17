import { NextRequest } from "next/server";
import { createClient } from "redis";

export const dynamic = "force-dynamic";

// Only allow safe identifiers — prevents Redis channel injection
const FLOW_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

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

      try {
        subscriber = createClient({ url: process.env.REDIS_URL });
        await subscriber.connect();
      } catch {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        return;
      }

      await subscriber.subscribe(`flow_updates:${flowId}`, (message) => {
        controller.enqueue(encoder.encode(`data: ${message}\n\n`));
      });

      req.signal.addEventListener("abort", async () => {
        clearInterval(heartbeat);
        try {
          await subscriber?.unsubscribe(`flow_updates:${flowId}`);
          await subscriber?.quit();
        } catch {
          /* best-effort cleanup */
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
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
