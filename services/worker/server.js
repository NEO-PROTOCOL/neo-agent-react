import Fastify from "fastify";
import { NeoWorker } from "../../packages/engine/worker.js";
import { NeoContextGateway, loadRuntimeDocuments } from "../../packages/engine/pilot/adapters.js";
import { prepareWeekIntent } from "../../packages/engine/pilot/contracts.js";
import { PilotLoop } from "../../packages/engine/pilot/PilotLoop.js";
import { createPilotRoles } from "../../packages/engine/pilot/roles.js";

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

app.post("/pilot/tasks/:taskId/run", async (request, reply) => {
  const { taskId } = request.params;
  if (!FLOW_ID_PATTERN.test(taskId)) {
    return reply.code(400).send({ error: "taskId invalido" });
  }

  let intent;
  let doctrine;
  try {
    intent = prepareWeekIntent({ ...(request.body || {}), task_id: taskId });
    doctrine = await loadRuntimeDocuments(process.env.NEO_AGENT_RUNTIME_ROOT);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Entrada invalida";
    return reply.code(400).send({ ok: false, error: message });
  }

  const worker = new NeoWorker();
  const roles = createPilotRoles({
    providerId: process.env.PILOT_PROVIDER || "gemini",
    model: process.env.PILOT_MODEL || undefined,
    documents: doctrine.documents,
  });
  const loop = new PilotLoop({
    worker,
    roles,
    memoryGateway: new NeoContextGateway(),
  });

  try {
    const result = await loop.run(intent, { doctrineVersion: doctrine.version });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no piloto";
    return reply.code(409).send({ ok: false, error: message });
  } finally {
    await worker.close();
  }
});

const port = Number(process.env.PORT || 4001);
const host = process.env.HOST || "0.0.0.0";

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
