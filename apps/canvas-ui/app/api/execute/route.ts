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
    
    // Fallback: tentar com domínio público se DNS privado falhar
    if (message.includes("ENOTFOUND") || message.includes("getaddrinfo")) {
      console.log(`[execute] DNS privado falhou, tentando domínio público...`);
      try {
        const publicUrl = `https://worker-production-bcef.up.railway.app/flows/${flowId}/execute`;
        console.log(`[execute] URL pública: ${publicUrl}`);
        
        const publicUpstream = await fetch(publicUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nodes }),
          signal: controller.signal,
        });

        console.log(`[execute] Status do worker (público): ${publicUpstream.status}`);
        const publicData = await publicUpstream.json();
        console.log(`[execute] Resposta do worker (público): ${JSON.stringify(publicData)}`);
        return Response.json(publicData, { status: publicUpstream.status });
      } catch (publicErr) {
        const publicMessage = publicErr instanceof Error ? publicErr.message : "Erro ao chamar worker público";
        console.error(`[execute] Erro no fallback público: ${publicMessage}`, publicErr);
        return Response.json({ error: publicMessage, details: String(publicErr) }, { status: 502 });
      }
    }
    
    return Response.json({ error: message, details: String(err) }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

