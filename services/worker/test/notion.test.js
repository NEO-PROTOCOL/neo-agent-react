import assert from "node:assert/strict";
import test from "node:test";
import { NotionSourceAdapter } from "../lib/NotionSourceAdapter.js";
import { MemoryTaskStateStore } from "../lib/MemoryTaskStateStore.js";
import { RuntimeCoordinator } from "../lib/RuntimeCoordinator.js";
import { PilotLoop } from "../../../packages/engine/pilot/PilotLoop.js";
import { prepareWeekIntent } from "../../../packages/engine/pilot/contracts.js";

const projects = [{ id: "project-1", repository: "https://github.com/NEO-PROTOCOL/neo-agent-react", name: "Agent" }];
const registry = { checksum: "a".repeat(64), nodes: [{ id: "neo-agent-react", repository: projects[0].repository + ".git" }] };
const rich = (value) => ({ type: "rich_text", rich_text: [{ plain_text: value }] });
const description = "Contexto:\nGerar checklist local.\n\nCritérios de aceite:\n- Conter Revisar backlog.\n\nRestrições:\n- Sem tools externas.";
function page() {
  return { id: "aaaabbbb-cccc-dddd-eeee-ffffffffffff", last_edited_time: "2026-09-03T10:00:00.000Z",
    parent: { data_source_id: "source-1" },
    properties: {
      Tarefa: { type: "title", title: [{ plain_text: "Checklist semanal" }] },
      Descrição: rich(description),
      "Incluir no Agent": { type: "checkbox", checkbox: true },
      Domínio: { type: "select", select: { name: "Trabalho" } },
      Organização: { type: "select", select: { name: "NEO-PROTOCOL" } },
      Projeto: { type: "relation", relation: [{ id: "project-1" }] },
      Prioridade: { type: "select", select: { name: "⚡ Média" } },
      Status: { type: "select", select: { name: "📋 Backlog" } },
      Responsável: { type: "people", people: [{ id: "person-1", name: "Operador" }] },
      "Data Planejada": { type: "date", date: { start: "2026-09-03" } },
      "Data Limite": { type: "date", date: { start: "2026-09-04" } },
    } };
}
const adapter = new NotionSourceAdapter({ apiKey: "test-key", dataSourceId: "source-1" });
const normalize = (p) => adapter.normalizePage(p, { registry, projects });
const now = () => new Date("2026-09-03T12:00:00.000Z");

function harness() {
  const store = new MemoryTaskStateStore();
  const jobs = new Map();
  const runtime = Object.assign(Object.create(RuntimeCoordinator.prototype), {
    store, now, runQueue: { async add(name, data, options) {
      if (!jobs.has(options.jobId)) jobs.set(options.jobId, { name, data });
      return { id: options.jobId };
    } },
  });
  return { store, jobs, runtime };
}

test("checkbox false → ignorado", () => {
  const p = page(); p.properties["Incluir no Agent"].checkbox = false;
  assert.equal(normalize(p), null);
});

test("checkbox true → WeekIntent preserva metadata e rota comprovada", () => {
  const intent = prepareWeekIntent(normalize(page()), now);
  assert.equal(intent.current_node, "neo-agent-react");
  assert.equal(intent.routing_status, "RESOLVED");
  assert.equal(intent.intake_status, "READY");
  assert.deepEqual(intent.acceptance_criteria, ["Conter Revisar backlog."]);
  assert.equal(intent.source.metadata.page_id, page().id);
  assert.equal(intent.source.metadata.executable.organization, "NEO-PROTOCOL");
  assert.equal(intent.source.metadata.human_state.responsible[0].id, "person-1");
  assert.match(intent.source.checksum_sha256, /^[a-f0-9]{64}$/);
});

test("critérios ausentes → NEEDS_HUMAN persistido antes de discovery/Operator", async () => {
  const p = page(); p.properties.Descrição = rich("Contexto:\nSó uma intenção.");
  const { runtime, store } = harness();
  const ingested = await runtime.ingestNotionIntent(normalize(p));
  let calls = 0;
  const loop = new PilotLoop({ worker: {
    getContext: (id) => store.getContext(id), setContextField: (...args) => store.setContextField(...args),
    executeNode: async () => { calls++; throw new Error("must not execute"); },
  }, memoryGateway: { persist: async () => ({ status: "unavailable" }) }, now });
  const result = await loop.run(ingested.intent);
  assert.equal(result.status, "NEEDS_HUMAN");
  assert.equal(result.approval.authority_rule, "NOTION_ACCEPTANCE_CRITERIA_MISSING");
  assert.equal(calls, 0);
  assert.deepEqual((await store.getIntent(ingested.intent.task_id)).acceptance_criteria, []);
  assert.equal((await store.getContext(ingested.intent.task_id)).approval.decision, "NEEDS_HUMAN");
});

test("Status-only → evento persistente e contexto atualizado, zero novo job mesmo após restart", async () => {
  const { runtime, store, jobs } = harness();
  const first = await runtime.ingestNotionIntent(normalize(page()));
  await store.setContextField(first.intent.task_id, "approval", { decision: "APPROVED" });
  const p = page(); p.last_edited_time = "2026-09-03T11:00:00.000Z";
  p.properties.Status.select.name = "🎯 Doing";
  const restarted = Object.assign(Object.create(RuntimeCoordinator.prototype), { store, now, runQueue: runtime.runQueue });
  const next = await restarted.ingestNotionIntent(normalize(p));
  assert.equal(next.claimed, false);
  assert.equal(next.intent.task_id, first.intent.task_id);
  assert.equal(next.jobId, null);
  assert.equal(jobs.size, 1);
  const state = await store.getContext(first.intent.task_id);
  assert.equal(state.notion_status_changed.to, "🎯 Doing");
  assert.equal(state.notion_status_changed.execution_requested, false);
  assert.equal(state.source_observation.revision, p.last_edited_time);
  assert.equal(state.source_observation.metadata.human_state.status, "🎯 Doing");
  assert.equal(state.intent.source.revision, page().last_edited_time);
  const eventCount = store.events.length;
  await restarted.ingestNotionIntent(normalize(p));
  assert.equal(store.events.length, eventCount);
});

for (const field of ["description", "criteria", "constraints", "priority", "planned_date", "due_date"]) {
  test(field + " → nova revisão processável", async () => {
    const { runtime, jobs } = harness();
    const first = await runtime.ingestNotionIntent(normalize(page()));
    const p = page(); p.last_edited_time = "2026-09-03T11:00:00.000Z";
    if (field === "description") p.properties.Descrição = rich(description.replace("checklist local", "checklist semanal local"));
    if (field === "criteria") p.properties.Descrição = rich(description.replace("Conter Revisar backlog.", "Conter Revisar backlog e prioridades."));
    if (field === "constraints") p.properties.Descrição = rich(description + "\n- Não publicar.");
    if (field === "priority") p.properties.Prioridade.select.name = "🔥 Alta";
    if (field === "planned_date") p.properties["Data Planejada"].date.start = "2026-09-05";
    if (field === "due_date") p.properties["Data Limite"].date.start = "2026-09-06";
    const next = await runtime.ingestNotionIntent(normalize(p));
    assert.equal(next.claimed, true);
    assert.notEqual(next.intent.task_id, first.intent.task_id);
    assert.notEqual(next.intent.source.checksum_sha256, first.intent.source.checksum_sha256);
    assert.equal(jobs.size, 2);
  });
}

test("organização/projeto sem correspondência → null / UNRESOLVED", () => {
  const p = page(); p.properties.Organização.select.name = "Unknown";
  const intent = prepareWeekIntent(normalize(p), now);
  assert.equal(intent.current_node, null);
  assert.equal(intent.routing_status, "UNRESOLVED");
  assert.equal(intent.intake_status, "NEEDS_HUMAN");
  assert.equal(adapter.normalizePage(page()).current_node, null);
});

test("mesmo snapshot duas vezes → uma task, um job, nenhum evento adicional", async () => {
  const { runtime, store, jobs } = harness();
  const first = await runtime.ingestNotionIntent(normalize(page()));
  const count = store.events.length;
  const second = await runtime.ingestNotionIntent(normalize(page()));
  assert.equal(second.claimed, false);
  assert.equal(second.intent.task_id, first.intent.task_id);
  assert.equal(store.tasks.size, 1);
  assert.equal(jobs.size, 1);
  assert.equal(store.events.length, count);
});

test("reversão de conteúdo A → B → A é nova revisão, não reusa Approval antigo", async () => {
  const { runtime, store } = harness();
  const first = await runtime.ingestNotionIntent(normalize(page()));
  const p = page(); p.last_edited_time = "2026-09-03T11:00:00.000Z";
  p.properties.Descrição = rich(description + "\n- Restrição nova.");
  await runtime.ingestNotionIntent(normalize(p));
  const reverted = page(); reverted.last_edited_time = "2026-09-03T12:00:00.000Z";
  const last = await runtime.ingestNotionIntent(normalize(reverted));
  assert.equal(last.claimed, true);
  assert.notEqual(last.intent.task_id, first.intent.task_id);
  assert.equal(store.tasks.size, 3);
});

test("paginação somente checkbox, read-only e sem vazamento da key para Orchestrator", async () => {
  const requests = [];
  let queries = 0;
  const a = new NotionSourceAdapter({ apiKey: "test-key", dataSourceId: "source-1", orchestratorUrl: "https://orchestrator.test",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (url.includes("/config/ecosystem.json")) return { ok: true, text: async () => JSON.stringify(registry.nodes) };
      if (url.includes("/pages/project-1")) return { ok: true, json: async () => ({ properties: { Nome: { type: "title", title: [{ plain_text: "Agent" }] }, GitHub: { url: projects[0].repository } } }) };
      queries++;
      return { ok: true, json: async () => ({ results: [page()], has_more: queries === 1, next_cursor: "cursor-2" }) };
    } });
  const result = await a.listWeekIntents();
  assert.equal(result.intents.length, 2);
  const queryRequests = requests.filter((r) => r.url.endsWith("/query"));
  assert.equal(queryRequests.length, 2);
  assert.deepEqual(JSON.parse(queryRequests[0].init.body).filter, { property: "Incluir no Agent", checkbox: { equals: true } });
  assert.equal(JSON.parse(queryRequests[1].init.body).start_cursor, "cursor-2");
  assert.equal(requests.find((r) => r.url.startsWith("https://orchestrator.test")).init.headers.authorization, undefined);
  assert.ok(requests.every((r) => r.init.method === "GET" || r.init.method === "POST" || !r.init.method));
});

test("Notion disabled sem data source", async () => {
  const a = new NotionSourceAdapter({ apiKey: "test", dataSourceId: "" });
  assert.deepEqual(await a.listWeekIntents(), { status: "disabled", intents: [] });
});
