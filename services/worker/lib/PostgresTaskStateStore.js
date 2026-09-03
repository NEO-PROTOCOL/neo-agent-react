import { createHash } from "node:crypto";
import pg from "pg";
import { planNotionIngestion, planControlledRetry } from "./NotionIngestion.js";

const { Pool } = pg;
const TERMINAL_STATUSES = new Set(["APPROVED", "NEEDS_HUMAN", "REJECTED"]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeError(error) {
  const message = error instanceof Error ? error.message : "provider_error";
  return message.replace(/https?:\/\/[^\s]+/g, "[redacted-url]").slice(0, 500);
}

export class PostgresTaskStateStore {
  constructor({ connectionString = process.env.DATABASE_URL, pool } = {}) {
    if (!pool && !connectionString) throw new Error("DATABASE_URL is required");
    this.pool = pool || new Pool({ connectionString, max: 8 });
    this.ownsPool = !pool;
  }

  async isReady() {
    await this.pool.query("SELECT 1");
    return true;
  }

  async claimTask(intent, client = this.pool) {
    const result = await client.query(
      `INSERT INTO agent_runtime.tasks (
         task_id, source_type, source_ref, source_revision, source_checksum, intent
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING task_id`,
      [
        intent.task_id,
        intent.source.type,
        intent.source.ref,
        intent.source.execution_revision || intent.source.revision || null,
        intent.source.checksum_sha256,
        JSON.stringify(intent),
      ]
    );
    return result.rowCount === 1;
  }

  async getIntent(taskId) {
    const result = await this.pool.query(
      "SELECT intent FROM agent_runtime.tasks WHERE task_id = $1",
      [taskId]
    );
    return result.rows[0]?.intent || null;
  }

  async getContext(taskId) {
    const result = await this.pool.query(
      `SELECT DISTINCT ON (record_key) record_key, payload
         FROM agent_runtime.task_events
        WHERE task_id = $1
        ORDER BY record_key, sequence DESC`,
      [taskId]
    );
    return Object.fromEntries(result.rows.map((row) => [row.record_key, row.payload]));
  }

  async ingestNotionIntent(incoming) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [incoming.source.ref]);
      const result = await client.query(
        `SELECT t.intent, e.payload AS observation FROM agent_runtime.tasks t
         JOIN agent_runtime.task_events e ON e.task_id = t.task_id
         WHERE t.source_type = 'notion' AND t.source_ref = $1 AND e.record_key = 'source_observation'
         ORDER BY e.sequence DESC LIMIT 1`, [incoming.source.ref]);
      const transition = planNotionIngestion(incoming, result.rows[0]);
      if (transition.claimed) {
        const claimed = await this.claimTask(transition.intent, client);
        if (!claimed) throw new Error("Notion execution revision conflict");
        await this.setContextField(transition.intent.task_id, "intent", transition.intent, client);
      }
      if (transition.changed) {
        if (transition.statusEvent) await this.setContextField(transition.intent.task_id, "notion_status_changed", transition.statusEvent, client);
        await this.setContextField(transition.intent.task_id, "source_observation", transition.observation, client);
      }
      await client.query("COMMIT");
      return transition;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async createControlledRetry(parentTaskId, requestId) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const parent = (await client.query("SELECT intent FROM agent_runtime.tasks WHERE task_id = $1", [parentTaskId])).rows[0]?.intent;
      if (!parent) throw new Error("Recovery parent not found");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [parent.source.ref]);
      const events = await client.query(
        "SELECT DISTINCT ON (record_key) record_key, payload FROM agent_runtime.task_events WHERE task_id = $1 ORDER BY record_key, sequence DESC",
        [parentTaskId]);
      const state = Object.fromEntries(events.rows.map((e) => [e.record_key, e.payload]));
      const transition = planControlledRetry(parent, state, requestId);
      if (state.controlled_retry_requested) {
        if (state.controlled_retry_requested.request_id !== requestId) throw new Error("A controlled recovery already exists");
        await client.query("COMMIT");
        return { intent: transition.intent, claimed: false };
      }
      const latest = await client.query(
        `SELECT t.task_id FROM agent_runtime.tasks t JOIN agent_runtime.task_events e ON e.task_id = t.task_id
         WHERE t.source_ref = $1 AND e.record_key = 'source_observation' ORDER BY e.sequence DESC LIMIT 1`, [parent.source.ref]);
      if (latest.rows[0]?.task_id !== parentTaskId) throw new Error("Source has a newer revision; recovery refused");
      if (!await this.claimTask(transition.intent, client)) throw new Error("Recovery identity conflict");
      const record = { ...transition.record, authorized_at: new Date().toISOString() };
      await this.setContextField(transition.intent.task_id, "intent", transition.intent, client);
      await this.setContextField(transition.intent.task_id, "controlled_retry", record, client);
      await this.setContextField(transition.intent.task_id, "source_observation", transition.observation, client);
      await this.setContextField(parentTaskId, "controlled_retry_requested", record, client);
      await client.query("COMMIT");
      return { intent: transition.intent, claimed: true };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async setContextField(taskId, key, value, transactionClient) {
    const client = transactionClient || await this.pool.connect();
    try {
      if (!transactionClient) await client.query("BEGIN");
      const task = await client.query(
        "SELECT task_id FROM agent_runtime.tasks WHERE task_id = $1 FOR UPDATE",
        [taskId]
      );
      if (!task.rowCount) throw new Error(`Unknown task: ${taskId}`);

      const previous = await client.query(
        `SELECT event_hash
           FROM agent_runtime.task_events
          WHERE task_id = $1
          ORDER BY sequence DESC
          LIMIT 1`,
        [taskId]
      );
      const previousHash = previous.rows[0]?.event_hash || "0".repeat(64);
      const canonicalPayload = JSON.stringify(canonicalize(value));
      const payloadHash = sha256(canonicalPayload);
      const eventHash = sha256(`${taskId}\0${key}\0${payloadHash}\0${previousHash}`);

      await client.query(
        `INSERT INTO agent_runtime.task_events (
           task_id, record_key, payload, payload_sha256, previous_hash, event_hash
         ) VALUES ($1, $2, $3::jsonb, $4, $5, $6)
         ON CONFLICT (task_id, record_key, payload_sha256) DO NOTHING`,
        [taskId, key, canonicalPayload, payloadHash, previousHash, eventHash]
      );

      if (key === "approval") {
        await client.query(
          `INSERT INTO agent_runtime.approvals (
             task_id, decision, decided_by, authority_rule, review_ref, payload
           ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT (task_id) DO NOTHING`,
          [
            taskId,
            value.decision,
            value.decided_by,
            value.authority_rule,
            value.review_ref || null,
            canonicalPayload,
          ]
        );
      }

      const status =
        key === "runtime"
          ? value.status
          : key === "approval"
            ? value.decision
            : key === "error"
              ? "NEEDS_HUMAN"
              : null;
      const attempt = key === "runtime" ? value.attempt : null;
      await client.query(
        `UPDATE agent_runtime.tasks
            SET status = COALESCE($2, status),
                attempt = COALESCE($3, attempt),
                updated_at = NOW()
          WHERE task_id = $1`,
        [taskId, status, attempt]
      );
      if (!transactionClient) await client.query("COMMIT");
    } catch (error) {
      if (!transactionClient) await client.query("ROLLBACK");
      throw error;
    } finally {
      if (!transactionClient) client.release();
    }
  }

  async listTaskSummaries(since) {
    const result = await this.pool.query(
      `SELECT task_id, status, attempt, source_type, source_ref, updated_at
         FROM agent_runtime.tasks
        WHERE updated_at >= $1
        ORDER BY updated_at ASC`,
      [since]
    );
    return result.rows;
  }

  async enqueueNotification(notification) {
    const result = await this.pool.query(
      `INSERT INTO agent_runtime.notification_outbox (
         task_id, kind, channel, dedupe_key, payload
       ) VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (dedupe_key, channel) DO NOTHING
       RETURNING id`,
      [
        notification.taskId || null,
        notification.kind,
        notification.channel,
        notification.dedupeKey,
        JSON.stringify(notification.payload),
      ]
    );
    return result.rows[0]?.id || null;
  }

  async listDispatchableNotifications(limit = 50) {
    const result = await this.pool.query(
      `SELECT id, attempts
         FROM agent_runtime.notification_outbox
        WHERE status IN ('PENDING', 'RETRY')
          AND available_at <= NOW()
        ORDER BY id ASC
        LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  async recoverStaleNotifications() {
    const result = await this.pool.query(
      `UPDATE agent_runtime.notification_outbox
          SET attempts = attempts + 1,
              status = CASE WHEN attempts + 1 >= 3 THEN 'DEAD' ELSE 'RETRY' END,
              available_at = NOW(),
              last_error = 'worker_restarted_during_delivery',
              updated_at = NOW()
        WHERE status = 'SENDING'
          AND updated_at < NOW() - INTERVAL '5 minutes'
      RETURNING id, status`
    );
    return result.rows;
  }

  async claimNotification(id) {
    const result = await this.pool.query(
      `UPDATE agent_runtime.notification_outbox
          SET status = 'SENDING', updated_at = NOW()
        WHERE id = $1
          AND status IN ('PENDING', 'RETRY')
          AND available_at <= NOW()
      RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  async completeNotification(id, { providerRef, skipped = false } = {}) {
    await this.pool.query(
      `UPDATE agent_runtime.notification_outbox
          SET status = $2,
              provider_ref = $3,
              last_error = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [id, skipped ? "SKIPPED" : "SENT", providerRef || null]
    );
  }

  async failNotification(id, error) {
    const result = await this.pool.query(
      `UPDATE agent_runtime.notification_outbox
          SET attempts = attempts + 1,
              status = CASE WHEN attempts + 1 >= 3 THEN 'DEAD' ELSE 'RETRY' END,
              available_at = CASE
                WHEN attempts + 1 >= 3 THEN available_at
                ELSE NOW() + make_interval(secs => (POWER(2, attempts) * 30)::int)
              END,
              last_error = $2,
              updated_at = NOW()
        WHERE id = $1
      RETURNING status, attempts, available_at`,
      [id, safeError(error)]
    );
    return result.rows[0] || null;
  }

  async getRuntimeHealth() {
    const result = await this.pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'DEAD')::int AS dead_notifications,
         COUNT(*) FILTER (WHERE status IN ('PENDING', 'RETRY'))::int AS pending_notifications
       FROM agent_runtime.notification_outbox`
    );
    return result.rows[0];
  }

  async close() {
    if (this.ownsPool) await this.pool.end();
  }
}

export { TERMINAL_STATUSES };
