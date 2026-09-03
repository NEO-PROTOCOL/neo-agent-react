import { planNotionIngestion } from "./NotionIngestion.js";

export class MemoryTaskStateStore {
  constructor() {
    this.tasks = new Map();
    this.outbox = new Map();
    this.nextOutboxId = 1;
    this.notionSources = new Map();
    this.events = [];
  }

  async isReady() {
    return true;
  }

  async claimTask(intent) {
    if (this.tasks.has(intent.task_id)) return false;
    this.tasks.set(intent.task_id, { intent: structuredClone(intent) });
    return true;
  }

  async getIntent(taskId) {
    return structuredClone(this.tasks.get(taskId)?.intent || null);
  }

  async ingestNotionIntent(incoming) {
    const transition = planNotionIngestion(incoming, this.notionSources.get(incoming.source.ref));
    if (transition.claimed) await this.claimTask(transition.intent);
    if (transition.changed) {
      if (transition.statusEvent) await this.setContextField(transition.intent.task_id, "notion_status_changed", transition.statusEvent);
      await this.setContextField(transition.intent.task_id, "source_observation", transition.observation);
      this.notionSources.set(incoming.source.ref, { intent: transition.intent, observation: transition.observation });
    }
    return transition;
  }

  async getContext(taskId) {
    return structuredClone(this.tasks.get(taskId) || {});
  }

  async setContextField(taskId, key, value) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    task[key] = structuredClone(value);
    const event = { taskId, key, value: structuredClone(value) };
    if (!this.events.some((existing) => JSON.stringify(existing) === JSON.stringify(event))) this.events.push(event);
  }

  async listTaskSummaries() {
    return [...this.tasks.entries()].map(([task_id, task]) => ({
      task_id,
      status: task.approval?.decision || task.runtime?.status || "RECEIVED",
      attempt: task.runtime?.attempt || 0,
      source_type: task.intent.source.type,
      source_ref: task.intent.source.ref,
      updated_at: new Date().toISOString(),
    }));
  }

  async enqueueNotification(notification) {
    const duplicate = [...this.outbox.values()].find(
      (item) => item.dedupe_key === notification.dedupeKey && item.channel === notification.channel
    );
    if (duplicate) return null;
    const id = this.nextOutboxId++;
    this.outbox.set(id, {
      id,
      task_id: notification.taskId || null,
      kind: notification.kind,
      channel: notification.channel,
      dedupe_key: notification.dedupeKey,
      payload: structuredClone(notification.payload),
      status: "PENDING",
      attempts: 0,
    });
    return id;
  }

  async listDispatchableNotifications() {
    return [...this.outbox.values()]
      .filter((item) => ["PENDING", "RETRY"].includes(item.status))
      .map(({ id, attempts }) => ({ id, attempts }));
  }

  async recoverStaleNotifications() {
    return [];
  }

  async claimNotification(id) {
    const item = this.outbox.get(id);
    if (!item || !["PENDING", "RETRY"].includes(item.status)) return null;
    item.status = "SENDING";
    return structuredClone(item);
  }

  async completeNotification(id, { providerRef, skipped = false } = {}) {
    const item = this.outbox.get(id);
    item.status = skipped ? "SKIPPED" : "SENT";
    item.provider_ref = providerRef || null;
  }

  async failNotification(id, error) {
    const item = this.outbox.get(id);
    item.attempts += 1;
    item.status = item.attempts >= 3 ? "DEAD" : "RETRY";
    item.last_error = error instanceof Error ? error.message : String(error);
    return { status: item.status, attempts: item.attempts };
  }

  async getRuntimeHealth() {
    const values = [...this.outbox.values()];
    return {
      dead_notifications: values.filter((item) => item.status === "DEAD").length,
      pending_notifications: values.filter((item) => ["PENDING", "RETRY"].includes(item.status)).length,
    };
  }

  async close() {}
}
