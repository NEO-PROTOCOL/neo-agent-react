import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { NeoWorker } from "../../../packages/engine/worker.js";
import { NeoContextGateway, loadRuntimeDocuments } from "../../../packages/engine/pilot/adapters.js";
import { prepareWeekIntent } from "../../../packages/engine/pilot/contracts.js";
import { PilotLoop } from "../../../packages/engine/pilot/PilotLoop.js";
import { createPilotRoles } from "../../../packages/engine/pilot/roles.js";

const RUN_QUEUE = "neo-agent-run";
const NOTIFICATION_QUEUE = "neo-agent-notifications";

function redisConnection(url) {
  if (!url) throw new Error("REDIS_URL is required");
  return new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

function periodKey(now, kind, timezone) {
  const format = (date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  if (kind === "daily_report") return format(now);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 6);
  return `${format(start)}_${format(now)}`;
}

export class RuntimeCoordinator {
  constructor({
    store,
    notion,
    notificationRouter,
    providerRegistry,
    redisUrl = process.env.REDIS_URL,
    logger = console,
    timezone = process.env.AGENT_TIMEZONE || "America/Sao_Paulo",
    now = () => new Date(),
  }) {
    this.store = store;
    this.notion = notion;
    this.notificationRouter = notificationRouter;
    this.providerRegistry = providerRegistry;
    this.logger = logger;
    this.timezone = timezone;
    this.now = now;
    this.runQueueConnection = redisConnection(redisUrl);
    this.runWorkerConnection = redisConnection(redisUrl);
    this.notificationQueueConnection = redisConnection(redisUrl);
    this.notificationWorkerConnection = redisConnection(redisUrl);
    this.runQueue = new Queue(RUN_QUEUE, { connection: this.runQueueConnection });
    this.notificationQueue = new Queue(NOTIFICATION_QUEUE, {
      connection: this.notificationQueueConnection,
    });
  }

  async start() {
    const doctrine = await loadRuntimeDocuments();
    await this.store.recoverStaleNotifications();
    this.doctrineVersion = doctrine.version;
    this.llmProviderId = process.env.PILOT_PROVIDER || "gemini";
    this.neoWorker = new NeoWorker({
      stateStore: this.store,
      persistNodeResults: false,
      logger: this.logger,
    });
    this.loop = new PilotLoop({
      worker: this.neoWorker,
      roles: createPilotRoles({
        providerId: this.llmProviderId,
        model: process.env.PILOT_MODEL || undefined,
        documents: doctrine.documents,
      }),
      memoryGateway: new NeoContextGateway(),
      now: this.now,
    });
    try {
      this.llmReady = this.neoWorker.runner.providerRegistry
        .resolve(this.llmProviderId)
        .isConfigured();
    } catch {
      this.llmReady = false;
    }
    this.runWorker = new Worker(RUN_QUEUE, (job) => this.#processRuntimeJob(job), {
      connection: this.runWorkerConnection,
      concurrency: 1,
      maxStalledCount: 1,
    });
    this.notificationWorker = new Worker(
      NOTIFICATION_QUEUE,
      (job) => this.#processNotificationJob(job),
      { connection: this.notificationWorkerConnection, concurrency: 2, maxStalledCount: 1 }
    );
    this.runWorker.on("failed", (job, error) =>
      this.#log("error", {
        event: "runtime_job_failed",
        job_id: job?.id,
        job_name: job?.name,
        error: error.message,
      })
    );
    this.notificationWorker.on("failed", (job, error) =>
      this.#log("error", {
        event: "notification_job_failed",
        job_id: job?.id,
        error: error.message,
      })
    );
    await Promise.all([
      this.runQueue.upsertJobScheduler(
        "notion-poll",
        { every: 10 * 60 * 1000 },
        { name: "notion-poll", data: {} }
      ),
      this.runQueue.upsertJobScheduler(
        "outbox-dispatch",
        { every: 60 * 1000 },
        { name: "outbox-dispatch", data: {} }
      ),
      this.runQueue.upsertJobScheduler(
        "daily-report",
        { pattern: "0 21 * * *", tz: this.timezone },
        { name: "daily-report", data: {} }
      ),
      this.runQueue.upsertJobScheduler(
        "weekly-report",
        { pattern: "0 21 * * 0", tz: this.timezone },
        { name: "weekly-report", data: {} }
      ),
    ]);
  }

  async enqueueIntent(rawIntent) {
    const intent = prepareWeekIntent(rawIntent, this.now);
    const claimed = await this.store.claimTask(intent);
    if (claimed) {
      await this.store.setContextField(intent.task_id, "intent", intent);
      await this.store.setContextField(intent.task_id, "runtime", {
        status: "RECEIVED",
        attempt: 0,
        doctrine_version: this.doctrineVersion,
        memory_status: "pending",
        started_at: this.now().toISOString(),
        updated_at: this.now().toISOString(),
      });
    } else {
      const stored = await this.store.getIntent(intent.task_id);
      if (!stored || stored.source.checksum_sha256 !== intent.source.checksum_sha256) {
        throw new Error(`Task ${intent.task_id} conflicts with persisted source`);
      }
    }
    const job = await this.runQueue.add("run-task", { taskId: intent.task_id }, {
      jobId: `task-${intent.task_id}`,
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    });
    const jobState = await job.getState();
    const recovered = jobState === "failed";
    if (recovered) await job.retry();
    return { intent, jobId: job.id, claimed, recovered };
  }

  async triggerNotionPoll() {
    const job = await this.runQueue.add("notion-poll", {}, { attempts: 1 });
    return { jobId: job.id };
  }

  async isReady() {
    const [postgres, redis] = await Promise.allSettled([
      this.store.isReady(),
      this.runQueueConnection.ping(),
    ]);
    return {
      ok: postgres.status === "fulfilled" && redis.status === "fulfilled" && this.llmReady,
      postgres: postgres.status === "fulfilled" ? "ok" : "unavailable",
      redis: redis.status === "fulfilled" ? "ok" : "unavailable",
      llm: this.llmReady ? "configured" : "unavailable",
      notion: this.notion.isConfigured() ? "configured" : "disabled",
      providers: Object.fromEntries(
        ["resend", "telegram", "ifttt"].map((channel) => [
          channel,
          this.providerRegistry.get(channel).isEnabled() ? "configured" : "disabled",
        ])
      ),
    };
  }

  async #processRuntimeJob(job) {
    if (job.name === "run-task") {
      const intent = await this.store.getIntent(job.data.taskId);
      if (!intent) throw new Error(`Persisted intent not found: ${job.data.taskId}`);
      const result = await this.loop.run(intent, { doctrineVersion: this.doctrineVersion });
      await this.notificationRouter.routeApproval(result);
      return { task_id: result.task_id, status: result.status };
    }
    if (job.name === "notion-poll") {
      const source = await this.notion.listWeekIntents();
      const accepted = [];
      for (const rawIntent of source.intents) {
        const queued = await this.enqueueIntent(rawIntent);
        accepted.push({ task_id: queued.intent.task_id, claimed: queued.claimed });
      }
      return { source_status: source.status, accepted };
    }
    if (job.name === "outbox-dispatch") {
      const notifications = await this.store.listDispatchableNotifications();
      for (const notification of notifications) {
        await this.notificationQueue.add("deliver", { outboxId: notification.id }, {
          jobId: `notification-${notification.id}-${notification.attempts}`,
          attempts: 1,
          removeOnComplete: 1000,
          removeOnFail: false,
        });
      }
      return { queued: notifications.length };
    }
    if (["daily-report", "weekly-report"].includes(job.name)) {
      const kind = job.name === "weekly-report" ? "weekly_report" : "daily_report";
      const durationMs = kind === "weekly_report" ? 7 * 86_400_000 : 86_400_000;
      const tasks = await this.store.listTaskSummaries(
        new Date(this.now().getTime() - durationMs).toISOString()
      );
      const id = await this.notificationRouter.createDigest({
        kind,
        tasks,
        periodKey: periodKey(this.now(), kind, this.timezone),
      });
      return { outbox_id: id, tasks: tasks.length };
    }
    throw new Error(`Unsupported runtime job: ${job.name}`);
  }

  async #processNotificationJob(job) {
    const notification = await this.store.claimNotification(job.data.outboxId);
    if (!notification) return { status: "deduped" };
    const provider = this.providerRegistry.get(notification.channel);
    try {
      const result = await provider.send(notification);
      const skipped = result.status === "disabled";
      await this.store.completeNotification(notification.id, {
        skipped,
        providerRef: result.resend_id || result.message_id || result.event_name,
      });
      return { status: skipped ? "skipped" : "sent" };
    } catch (error) {
      const retry = await this.store.failNotification(notification.id, error);
      this.#log("warn", {
        event: "notification_delivery_deferred",
        outbox_id: notification.id,
        channel: notification.channel,
        status: retry?.status,
      });
      return { status: retry?.status || "retry" };
    }
  }

  #log(level, record) {
    const method = typeof this.logger[level] === "function" ? level : "info";
    this.logger[method](record);
  }

  async close() {
    await Promise.allSettled([
      this.runWorker?.close(),
      this.notificationWorker?.close(),
      this.runQueue.close(),
      this.notificationQueue.close(),
      this.neoWorker?.close(),
    ]);
    await Promise.allSettled([
      this.runQueueConnection.quit(),
      this.runWorkerConnection.quit(),
      this.notificationQueueConnection.quit(),
      this.notificationWorkerConnection.quit(),
    ]);
  }
}

export { NOTIFICATION_QUEUE, RUN_QUEUE };
