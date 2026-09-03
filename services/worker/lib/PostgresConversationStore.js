import { randomUUID } from "node:crypto";

export class ConversationConflict extends Error {
  constructor(code) { super(code); this.code = code; }
}

export class PostgresConversationStore {
  constructor({ pool, retentionDays = 7 }) {
    if (!pool) throw new Error("Conversation store requires the runtime PostgreSQL pool");
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 30) {
      throw new Error("Conversation retention must be between 1 and 30 days");
    }
    this.pool = pool;
    this.retentionDays = retentionDays;
  }

  async isReady() {
    await this.pool.query("SELECT conversation_id FROM agent_runtime.conversation_sessions LIMIT 0");
    await this.pool.query("SELECT turn_id FROM agent_runtime.conversation_turns LIMIT 0");
    return true;
  }

  async turn(input, handler) {
    const pending = this.pool.connect();
    let timer;
    let client;
    try {
      client = await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new ConversationConflict("CONVERSATION_BUSY")), 500);
      })]);
    } catch (error) {
      pending.then((lateClient) => lateClient.release(), () => {});
      throw error;
    } finally { clearTimeout(timer); }
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '1500ms'");
      const lock = await client.query(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired",
        [`conversation:${input.actorHash}`]
      );
      if (!lock.rows[0].acquired) throw new ConversationConflict("CONVERSATION_BUSY");
      await client.query(
        `INSERT INTO agent_runtime.conversation_sessions
         (conversation_id, actor_hash, channel, channel_session_hash, status, expires_at)
         VALUES ($1, $2, 'alexa', $3, 'OPEN', NOW() + make_interval(days => $4))
         ON CONFLICT (actor_hash) DO NOTHING`,
        [randomUUID(), input.actorHash, input.sessionHash, this.retentionDays]
      );
      const session = (await client.query(
        `SELECT *, expires_at <= NOW() AS expired
         FROM agent_runtime.conversation_sessions WHERE actor_hash = $1 FOR UPDATE`,
        [input.actorHash]
      )).rows[0];
      const prior = (await client.query(
        `SELECT request_checksum, response FROM agent_runtime.conversation_turns
         WHERE conversation_id = $1 AND request_id = $2 AND expires_at > NOW()`,
        [session.conversation_id, input.requestId]
      )).rows[0];
      if (prior) {
        if (prior.request_checksum !== input.checksum) throw new ConversationConflict("REQUEST_ID_CONFLICT");
        await client.query("COMMIT");
        return { response: prior.response, replayed: true };
      }
      const recent = await client.query(
        `SELECT kind, input_text, evidence, request_timestamp
         FROM agent_runtime.conversation_turns WHERE conversation_id = $1 AND expires_at > NOW()
         ORDER BY sequence DESC LIMIT 10`, [session.conversation_id]
      );
      const latest = recent.rows[0];
      if (latest && new Date(input.timestamp) < new Date(latest.request_timestamp)) {
        throw new ConversationConflict("STALE_CONVERSATION_REQUEST");
      }
      const window = await client.query(
        `SELECT COUNT(*)::int AS count FROM agent_runtime.conversation_turns
         WHERE conversation_id = $1 AND created_at > NOW() - INTERVAL '1 minute'`,
        [session.conversation_id]
      );
      if (window.rows[0].count >= 12) throw new ConversationConflict("CONVERSATION_RATE_LIMIT");
      const loadTasks = async (taskIds) => {
        const tasks = await client.query(
          `SELECT task_id, intent, status, updated_at FROM agent_runtime.tasks
           WHERE task_id = ANY($1::text[]) ORDER BY task_id`, [taskIds]
        );
        return Promise.all(tasks.rows.map(async (task) => {
          const records = await client.query(
            `SELECT DISTINCT ON (record_key) record_key, payload, sequence
             FROM agent_runtime.task_events WHERE task_id = $1
             AND record_key IN ('approval','execution_1','execution_2','source_observation')
             ORDER BY record_key, sequence DESC`, [task.task_id]
          );
          return { ...task, records: records.rows };
        }));
      };
      const result = await handler({
        context: session.expired ? {} : session.context,
        history: session.expired ? [] : recent.rows.reverse(),
        loadTasks,
      });
      if (input.deadline && Date.now() >= input.deadline) throw new ConversationConflict("CONVERSATION_DEADLINE");
      await client.query(
        `INSERT INTO agent_runtime.conversation_turns
         (turn_id, conversation_id, request_id, request_checksum, channel_session_hash,
          request_timestamp, kind, input_text, response, evidence, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,NOW() + make_interval(days => $11))`,
        [randomUUID(), session.conversation_id, input.requestId, input.checksum, input.sessionHash,
          input.timestamp, input.kind, input.text, JSON.stringify(result.response),
          JSON.stringify(result.evidence), this.retentionDays]
      );
      await client.query(
        `UPDATE agent_runtime.conversation_sessions
         SET context=$2::jsonb, channel_session_hash=$3, status=$4, updated_at=NOW(),
         expires_at=NOW() + make_interval(days => $5) WHERE conversation_id=$1`,
        [session.conversation_id, JSON.stringify(result.context), input.sessionHash,
          result.closed ? "CLOSED" : "OPEN", this.retentionDays]
      );
      await client.query("COMMIT");
      return { response: result.response, replayed: false };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  // Scheduled cleanup affects only ephemeral conversations, never task_events.
  async purgeExpired() {
    await this.pool.query("DELETE FROM agent_runtime.conversation_turns WHERE expires_at <= NOW()");
    await this.pool.query(
      "UPDATE agent_runtime.conversation_sessions SET context='{}'::jsonb, status='CLOSED' WHERE expires_at <= NOW()"
    );
  }
}
