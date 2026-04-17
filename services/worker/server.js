import Fastify from "fastify";
import { NeoWorker } from "../../packages/engine/worker.js";

const FLOW_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const MAX_NODES_PER_REQUEST = 50;

const app = Fastify({
  logger: true,
  bodyLimit: 512 * 1024,
});

app.get("/health", async () => ({ ok: true, service: "neo-worker" }));

app.post("/flows/:flowId/execute", async (request, reply) => {
  const { flowId } = request.params;

  if (!FLOW_ID_PATTERN.test(flowId)) {
    return reply.code(400).send({ error: "flowId inválido" });
  }

  const body = request.body || {};
  const { nodes } = body;

  if (!Array.isArray(nodes) || nodes.length === 0) {
    return reply.code(400).send({ error: "Body deve conter nodes[]" });
  }

  if (nodes.length > MAX_NODES_PER_REQUEST) {
    return reply.code(400).send({ error: `Máximo de ${MAX_NODES_PER_REQUEST} nós por execução` });
  }

  const worker = new NeoWorker();
  const results = [];

  try {
    for (const node of nodes) {
      const result = await worker.executeNode(flowId, node);
      results.push({ id: node.id, result });
    }
    return { ok: true, flowId, processed: results.length, results };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha na execução";
    return reply.code(500).send({ ok: false, error: message });
  } finally {
    await worker.close();
  }
});

const port = Number(process.env.PORT || 4001);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
