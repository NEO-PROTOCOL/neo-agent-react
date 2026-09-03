import { parseArgs } from "node:util";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { PostgresTaskStateStore } from "../lib/PostgresTaskStateStore.js";

const { values } = parseArgs({ options: {
  task: { type: "string" }, request: { type: "string" }, approve: { type: "boolean", default: false },
} });
if (!values.approve || !values.task || !values.request) {
  throw new Error("Explicit approval required: --task ID --request IDEMPOTENCY_KEY --approve");
}
if (!process.env.DATABASE_URL || !process.env.REDIS_URL) throw new Error("Runtime database/queue not configured");
const store = new PostgresTaskStateStore();
const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue("neo-agent-run", { connection });
try {
  const result = await store.createControlledRetry(values.task, values.request);
  const state = await store.getContext(result.intent.task_id);
  const job = state.approval ? null : await queue.add("run-task", { taskId: result.intent.task_id }, {
    jobId: `task-${result.intent.task_id}`, attempts: 1, removeOnComplete: false, removeOnFail: false,
  });
  console.info(JSON.stringify({ event: "CONTROLLED_REPROCESSING_QUEUED", parent_task_id: values.task,
    task_id: result.intent.task_id, claimed: result.claimed, job_id: job?.id || null,
    approval: state.approval?.decision || null }));
} finally {
  await queue.close(); await connection.quit(); await store.close();
}
