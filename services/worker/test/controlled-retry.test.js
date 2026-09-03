import assert from "node:assert/strict";
import test from "node:test";
import { planControlledRetry, planNotionIngestion } from "../lib/NotionIngestion.js";
import { PostgresTaskStateStore } from "../lib/PostgresTaskStateStore.js";
import { prepareWeekIntent } from "../../../packages/engine/pilot/contracts.js";

function fixture() {
  const intent = prepareWeekIntent({ task_id: "original", current_node: "neo-agent-react", routing_status: "RESOLVED",
    intention: "Checklist", acceptance_criteria: ["Conter Revisar backlog"],
    source: { type: "notion", ref: "notion:page", revision: "2026-09-03T04:06:00.000Z",
      metadata: { page_id: "page", executable: { title: "Checklist" }, human_state: { status: "Backlog" } } },
  });
  const state = { plan: { steps: [] },
    error: { code: "PILOT_EXECUTION_ERROR", message: "Falha: provider nao retornou JSON valido" },
    approval: { decision: "NEEDS_HUMAN", authority_rule: "PILOT_EXECUTION_ERROR" },
    source_observation: { revision: intent.source.revision, checksum_sha256: intent.source.checksum_sha256,
      metadata: structuredClone(intent.source.metadata) },
  };
  return { intent, state };
}

test("controlled retry keeps original intent/approval unchanged, new task ID and same executable checksum", () => {
  const { intent, state } = fixture();
  const before = JSON.stringify({ intent, state });
  const retry = planControlledRetry(intent, state, "approved-request-1");
  assert.equal(JSON.stringify({ intent, state }), before);
  assert.notEqual(retry.intent.task_id, intent.task_id);
  assert.equal(retry.intent.source.checksum_sha256, intent.source.checksum_sha256);
  assert.equal(retry.intent.source.revision, intent.source.revision);
  assert.equal(retry.record.parent_task_id, intent.task_id);
  assert.deepEqual(retry.record.previous_approval, state.approval);
  assert.deepEqual(planControlledRetry(intent, state, "approved-request-1"), retry);
});

test("recovery refuses approved, unrelated, non-Executor and nested retries", () => {
  for (const edit of [
    (s) => { s.approval.decision = "APPROVED"; },
    (s) => { s.error.message = "network error"; },
    (s) => { delete s.plan; },
    (s) => { s.review_1 = {}; },
    (s) => { s.controlled_retry = {}; },
  ]) {
    const { intent, state } = fixture(); edit(state);
    assert.throws(() => planControlledRetry(intent, state, "request-1"), /Controlled recovery/);
  }
});

test("source polling after retry points to its latest attempt and never creates another revision", () => {
  const { intent, state } = fixture();
  const retry = planControlledRetry(intent, state, "request-1");
  const poll = planNotionIngestion(intent, { intent: retry.intent, observation: retry.observation });
  assert.equal(poll.claimed, false);
  assert.equal(poll.changed, false);
  assert.equal(poll.intent.task_id, retry.intent.task_id);
});

test("proven Operator MAX_TOKENS in controlled recovery permits a separately identified attempt", () => {
  const { intent, state } = fixture();
  delete state.plan;
  state.controlled_retry = { parent_task_id: "earlier-attempt" };
  state.error = { code: "PILOT_EXECUTION_ERROR", diagnostic_ref: "provider_diagnostic_test" };
  state.provider_diagnostic_test = { node_id: "operator", failure_kind: "INCOMPLETE_MAX_TOKENS" };
  const retry = planControlledRetry(intent, state, "operator-budget-gap-1");
  assert.equal(retry.record.parent_task_id, intent.task_id);
  assert.notEqual(retry.intent.task_id, intent.task_id);
  state.provider_diagnostic_test.failure_kind = "INVALID_JSON";
  assert.throws(() => planControlledRetry(intent, state, "operator-budget-gap-1"), /Controlled recovery/);
});

function transactionHarness() {
  const { intent, state } = fixture();
  const tasks = new Map([[intent.task_id, intent]]);
  const contexts = new Map([[intent.task_id, structuredClone(state)]]);
  const writes = [];
  const queries = [];
  let latest = intent.task_id;
  const client = { release() {}, async query(sql, args = []) {
    queries.push(sql);
    if (sql.startsWith("SELECT intent")) return { rows: tasks.has(args[0]) ? [{ intent: tasks.get(args[0]) }] : [] };
    if (sql.startsWith("SELECT DISTINCT")) return { rows: Object.entries(contexts.get(args[0]) || {}).map(([record_key, payload]) => ({ record_key, payload })) };
    if (sql.includes("SELECT t.task_id")) return { rows: [{ task_id: latest }] };
    return { rows: [] };
  } };
  const store = new PostgresTaskStateStore({ pool: { connect: async () => client } });
  store.claimTask = async (next, c) => { assert.equal(c, client); tasks.set(next.task_id, structuredClone(next)); return true; };
  store.setContextField = async (id, key, payload, c) => {
    assert.equal(c, client); writes.push({ id, key, payload: structuredClone(payload) });
    contexts.set(id, { ...contexts.get(id), [key]: payload });
    if (key === "source_observation") latest = id;
  };
  return { store, tasks, contexts, writes, queries, intent, state };
}

test("Postgres recovery transaction appends lineage once, preserves old approval and dedupes same request", async () => {
  const h = transactionHarness();
  const originalApproval = structuredClone(h.state.approval);
  const first = await h.store.createControlledRetry("original", "request-1");
  const second = await h.store.createControlledRetry("original", "request-1");
  assert.equal(first.claimed, true);
  assert.equal(second.claimed, false);
  assert.equal(second.intent.task_id, first.intent.task_id);
  assert.equal(h.tasks.size, 2);
  assert.equal(h.writes.length, 4);
  assert.deepEqual(h.writes.map((w) => w.key), ["intent", "controlled_retry", "source_observation", "controlled_retry_requested"]);
  assert.deepEqual(h.contexts.get("original").approval, originalApproval);
  assert.ok(h.queries.some((q) => q.includes("pg_advisory_xact_lock")));
  assert.ok(!h.queries.some((q) => /DELETE|UPDATE/.test(q)));
  await assert.rejects(h.store.createControlledRetry("original", "request-2"), /already exists/);
  assert.equal(h.tasks.size, 2);
});
