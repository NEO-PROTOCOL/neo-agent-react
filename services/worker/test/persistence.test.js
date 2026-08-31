import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PostgresTaskStateStore } from "../lib/PostgresTaskStateStore.js";

test("migration torna task_events append-only e persiste approvals separadamente", async () => {
  const sql = await readFile(
    new URL("../migrations/001_agent_runtime.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS agent_runtime\.approvals/);
  assert.match(sql, /CREATE TRIGGER task_events_append_only/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON agent_runtime\.task_events/);
});

test("recovery devolve entregas SENDING antigas ao outbox com limite de tentativas", async () => {
  let query;
  const pool = {
    async query(sql) {
      query = sql;
      return { rows: [{ id: 1, status: "RETRY" }] };
    },
  };
  const store = new PostgresTaskStateStore({ pool });
  const recovered = await store.recoverStaleNotifications();

  assert.deepEqual(recovered, [{ id: 1, status: "RETRY" }]);
  assert.match(query, /WHERE status = 'SENDING'/);
  assert.match(query, /attempts \+ 1 >= 3/);
  assert.match(query, /INTERVAL '5 minutes'/);
});
