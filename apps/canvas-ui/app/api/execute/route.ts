import { NextRequest } from "next/server";

const FLOW_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export async function POST(req: NextRequest) {
  let body: { flowId?: unknown; nodes?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const { flowId, nodes } = body;

  if (typeof flowId !== "string" || !FLOW_ID_PATTERN.test(flowId)) {
    return Response.json({ error: "flowId inválido" }, { status: 400 });
  }

  if (!Array.isArray(nodes) || nodes.length === 0) {
    return Response.json({ error: "nodes[] obrigatório" }, { status: 400 });
  }

  const workerUrl = process.env.WORKER_BASE_URL;
  if (!workerUrl) {
    return Response.json({ error: "WORKER_BASE_URL não configurado" }, { status: 503 });
  }

  // Log only safe metadata — never payload content
  console.log(`[execute] flowId=${flowId} nodes=${nodes.length}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000); // 2 min

  try {
    const upstream = await fetch(`${workerUrl}/flows/${flowId}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodes }),
      signal: controller.signal,
    });

    console.log(`[execute] worker_status=${upstream.status} flowId=${flowId}`);
    const data = await upstream.json();
    return Response.json(data, { status: upstream.status });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    // Internal details stay in server logs only, never sent to client
    console.error(`[execute] worker_error flowId=${flowId}`, err);
    return Response.json(
      { error: isTimeout ? "timeout_calling_worker" : "worker_unreachable" },
      { status: isTimeout ? 504 : 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
