import { timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import { NotionSourceAdapter } from "./lib/NotionSourceAdapter.js";
import { NotificationRouter } from "./lib/NotificationRouter.js";
import {
  IFTTTProvider,
  NotificationProviderRegistry,
  ResendProvider,
  TelegramProvider,
} from "./lib/NotificationProviders.js";
import { PostgresTaskStateStore } from "./lib/PostgresTaskStateStore.js";
import { RuntimeCoordinator } from "./lib/RuntimeCoordinator.js";
import { alexaConfig, alexaResponse, isAlexaRoute, registerAlexaChannel } from "./lib/AlexaChannel.js";
import { ConversationGateway } from "./lib/ConversationGateway.js";
import { PostgresConversationStore } from "./lib/PostgresConversationStore.js";

const TASK_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const runtimeApiKey = process.env.RUNTIME_API_KEY;

if (!runtimeApiKey) throw new Error("RUNTIME_API_KEY is required");

const app = Fastify({ logger: true, bodyLimit: 512 * 1024 });
const store = new PostgresTaskStateStore();
const alexa = alexaConfig();
const conversationStore = new PostgresConversationStore({ pool: store.pool,
  retentionDays: Number(process.env.CONVERSATION_RETENTION_DAYS || 7) });
const conversationGateway = new ConversationGateway({ store: conversationStore,
  taskIds: alexa.taskIds, respond: alexaResponse });
const notion = new NotionSourceAdapter();
const providerRegistry = new NotificationProviderRegistry([
  new ResendProvider(),
  new TelegramProvider(),
  new IFTTTProvider(),
]);
const notificationRouter = new NotificationRouter({ store, providerRegistry });
const runtime = new RuntimeCoordinator({
  store,
  notion,
  notificationRouter,
  providerRegistry,
  logger: app.log,
  conversationStore,
});

function authorized(header) {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(runtimeApiKey);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

app.addHook("onRequest", async (request, reply) => {
  // Only the registered raw-body Alexa route has this server-owned flag.
  // It verifies Amazon signatures, application ID and the development user itself.
  if (isAlexaRoute(request)) return;
  if (["/live", "/ready", "/health"].includes(request.url.split("?")[0])) return;
  if (!authorized(request.headers.authorization)) {
    return reply.code(401).send({ error: "unauthorized" });
  }
});

const alexaChannel = await registerAlexaChannel(app, {
  config: alexa, gateway: conversationGateway, store: conversationStore,
});
async function readiness() {
  const [health, alexaHealth] = await Promise.all([runtime.isReady(), alexaChannel.health()]);
  return { ...health, ok: health.ok && alexaHealth !== "unavailable", alexa: alexaHealth };
}

app.get("/live", async () => ({ ok: true, service: "neo-agent-react-runtime" }));
app.get("/ready", async (_request, reply) => {
  const health = await readiness();
  return reply.code(health.ok ? 200 : 503).send(health);
});
app.get("/health", async (_request, reply) => {
  const health = await readiness();
  return reply.code(health.ok ? 200 : 503).send(health);
});

app.post("/pilot/tasks/:taskId/run", async (request, reply) => {
  const { taskId } = request.params;
  if (!TASK_ID_PATTERN.test(taskId)) return reply.code(400).send({ error: "invalid_task_id" });
  try {
    const queued = await runtime.enqueueIntent({ ...(request.body || {}), task_id: taskId });
    return reply.code(202).send({
      ok: true,
      task_id: queued.intent.task_id,
      job_id: queued.jobId,
      accepted: queued.claimed,
      recovered: queued.recovered,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "enqueue_failed";
    request.log.warn({ event: "task_enqueue_rejected", task_id: taskId, error: message });
    return reply.code(409).send({ ok: false, error: message });
  }
});

app.get("/pilot/tasks/:taskId", async (request, reply) => {
  const { taskId } = request.params;
  if (!TASK_ID_PATTERN.test(taskId)) return reply.code(400).send({ error: "invalid_task_id" });
  const state = await store.getContext(taskId);
  if (!Object.keys(state).length) return reply.code(404).send({ error: "task_not_found" });
  return { task_id: taskId, state };
});

app.post("/sources/notion/poll", async (request, reply) => {
  const pageId = request.body?.page_id;
  if (pageId && !/^[0-9a-f-]{32,36}$/i.test(pageId)) return reply.code(400).send({ error: "invalid_page_id" });
  const queued = await runtime.triggerNotionPoll({ pageId });
  return reply.code(202).send({ ok: true, job_id: queued.jobId });
});

const shutdown = async (signal) => {
  app.log.info({ event: "shutdown_started", signal });
  await app.close();
  await runtime.close();
  await store.close();
};

process.once("SIGTERM", () => shutdown("SIGTERM").finally(() => process.exit(0)));
process.once("SIGINT", () => shutdown("SIGINT").finally(() => process.exit(0)));

await runtime.start();
const port = Number(process.env.PORT || 4001);
const host = process.env.HOST || "0.0.0.0";
await app.listen({ port, host });
