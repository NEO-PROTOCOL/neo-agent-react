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

  console.log(`[execute] Chamando worker em: ${workerUrl}/flows/${flowId}/execute`);
  console.log(`[execute] Nodes: ${JSON.stringify(nodes)}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000); // 2 min

  try {
    const url = `${workerUrl}/flows/${flowId}/execute`;
    console.log(`[execute] URL completa: ${url}`);

    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodes }),
      signal: controller.signal,
    });

    console.log(`[execute] Status do worker: ${upstream.status}`);
    const data = await upstream.json();
    console.log(`[execute] Resposta do worker: ${JSON.stringify(data)}`);
    return Response.json(data, { status: upstream.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao chamar worker";
    console.error(`[execute] Erro: ${message}`, err);
    return Response.json({ error: message, details: String(err) }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

