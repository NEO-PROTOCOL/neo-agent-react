import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { SelectiveContextRetriever } from "./adapters.js";
import { prepareWeekIntent } from "./contracts.js";
import { PilotLoop } from "./PilotLoop.js";
import { createPilotRoles } from "./roles.js";

const NOW = "2026-08-31T12:00:00.000Z";
const QUESTION = "Como estruturar repasse financeiro para creators na operação TikTok?";
const CRITERIA = [
  "Identificar as fontes TikTok e FlowPay relevantes",
  "Não afirmar integração entre FlowPay e TikTok sem evidência",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function intentInput(taskId, overrides = {}) {
  return {
    task_id: taskId,
    current_node: "flowoff-tiktok-control-plane",
    intention: QUESTION,
    acceptance_criteria: CRITERIA,
    constraints: ["Somente saída estruturada; nenhuma tool externa no Executor"],
    source: { type: "manual", ref: `manual://${taskId}`, revision: "1" },
    ...overrides,
  };
}

function source(sourceId, nodeId, relationKind, path) {
  const repositories = {
    "flowoff-tiktok-control-plane": "https://github.com/neo-tiktok-partner-br/flowoff-tiktok-control-plane.git",
    flowpay: "https://github.com/flowpay-system/flowpay-system-workspace.git",
  };
  return {
    source_id: sourceId,
    node_id: nodeId,
    kind: "repository-file",
    repository: repositories[nodeId],
    ref: "main",
    path,
    authority: "canonical",
    topics: nodeId === "flowpay" ? ["finance", "settlement"] : ["tiktok", "creators"],
    relation_kind: relationKind,
    match_reasons: nodeId === "flowpay" ? ["finance"] : ["tiktok", "creators"],
  };
}

const TIKTOK_SOURCE = source(
  "tiktok-platform-architecture",
  "flowoff-tiktok-control-plane",
  "knowledge",
  "docs/PLATFORM_ARCHITECTURE_2026.md"
);
const FLOWPAY_SOURCE = source(
  "flowpay-system-context",
  "flowpay",
  "knowledge_candidate",
  "CONTEXT.md"
);

function discoveryResponse({ status = "completed", selectedSources = [TIKTOK_SOURCE, FLOWPAY_SOURCE] } = {}) {
  const required = status === "completed";
  return {
    schema_version: "context.discovery.v1",
    status,
    query: QUESTION,
    current_node: "flowoff-tiktok-control-plane",
    registry_checksum: "2".repeat(64),
    cross_domain_required: required,
    nodes_considered: required
      ? [
          {
            node_id: "flowoff-tiktok-control-plane",
            score: 147,
            relation_kind: "knowledge",
            reasons: ["current_node", "domains:tiktok,creators"],
          },
          {
            node_id: "flowpay",
            score: 68,
            relation_kind: "knowledge_candidate",
            reasons: ["domains:finance,payments,settlement"],
          },
        ]
      : [
          {
            node_id: "neo-agent-react",
            score: 100,
            relation_kind: "knowledge",
            reasons: ["current_node"],
          },
        ],
    selected_sources: required ? selectedSources : [],
    ...(required ? {} : { not_required_reason: "no_cross_node_match" }),
    budget: {
      max_nodes: 3,
      max_sources: 4,
      max_hops: 1,
      max_characters: 12000,
      used_nodes: required ? 2 : 1,
      used_sources: required ? selectedSources.length : 0,
      used_hops: required ? 1 : 0,
      used_characters: 0,
    },
  };
}

function retrievedEntry(selectedSource, content) {
  return {
    source_id: selectedSource.source_id,
    node_id: selectedSource.node_id,
    relation_kind: selectedSource.relation_kind,
    authority: selectedSource.authority,
    repository: selectedSource.repository,
    ref: selectedSource.ref,
    path: selectedSource.path,
    checksum_sha256: sha256(content),
    characters: content.length,
    content,
  };
}

class ScriptedWorker {
  constructor(responses, trace = []) {
    this.responses = [...responses];
    this.trace = trace;
    this.contexts = new Map();
  }

  async getContext(taskId) {
    return structuredClone(this.contexts.get(taskId) || {});
  }

  async setContextField(taskId, key, value) {
    const context = this.contexts.get(taskId) || {};
    context[key] = structuredClone(value);
    this.contexts.set(taskId, context);
  }

  async executeNode(_taskId, config) {
    this.trace.push(config.id);
    if (!this.responses.length) throw new Error(`Missing response for ${config.id}`);
    return structuredClone(this.responses.shift());
  }
}

class DiscoveryGatewayStub {
  constructor(response, trace = []) {
    this.response = response;
    this.trace = trace;
    this.calls = 0;
  }

  async discover() {
    this.calls += 1;
    this.trace.push("context_discovery");
    if (this.response instanceof Error) throw this.response;
    return structuredClone(this.response);
  }
}

class RetrieverStub {
  constructor(entries, trace = [], error = null) {
    this.entries = entries;
    this.trace = trace;
    this.error = error;
    this.calls = 0;
    this.adapter = new SelectiveContextRetriever({
      fetchImpl: async (url) => {
        const entry = this.entries.find((candidate) =>
          url.includes(`/contents/${candidate.path}?ref=`)
        );
        return entry
          ? { ok: true, text: async () => entry.content }
          : { ok: false, status: 404, text: async () => "" };
      },
    });
  }

  async retrieve(input) {
    this.calls += 1;
    this.trace.push("selective_context_retrieval");
    if (this.error) throw this.error;
    return this.adapter.retrieve(input);
  }
}

class MemoryGatewayStub {
  constructor(trace = []) {
    this.trace = trace;
  }

  async recall() {
    this.trace.push("memory_recall");
    return { status: "ok", hits: [] };
  }

  async persist() {
    this.trace.push("memory_persist");
    return { status: "ok", id: "memory-e2e" };
  }
}

function task(intent) {
  return {
    schema_version: "pilot.v1",
    task_id: intent.task_id,
    current_node: intent.current_node,
    objective: QUESTION,
    acceptance_criteria: intent.acceptance_criteria,
    source: intent.source,
    scope: {
      allowed_effects: ["none", "local_state"],
      forbidden_targets: [
        "production", "git", "filesystem", "network", "secrets", "growth", "tiktok", "nox", "flowpay",
      ],
    },
    risk: "low",
    max_attempts: 2,
    created_at: NOW,
  };
}

function plan(taskId) {
  return {
    schema_version: "pilot.v1",
    task_id: taskId,
    steps: [
      {
        id: "step-1",
        instruction: "Estruturar uma proposta distinguindo conhecimento de integração comprovada.",
        effect: "none",
        expected_evidence: "Resposta com fontes e fronteira de integração explícita.",
      },
    ],
    assumptions: [],
    created_at: NOW,
  };
}

function execution(taskId, flowpayRelation = "knowledge_candidate") {
  const markdown = [
    "Use o control plane TikTok para ownership e jornadas de creators.",
    "Use FlowPay apenas como referência financeira candidata para settlement.",
    "Não há evidência de integração FlowPay ↔ TikTok neste discovery.",
  ].join("\n");
  return {
    schema_version: "pilot.v1",
    task_id: taskId,
    action: {
      action_id: "action-1",
      step_id: "step-1",
      attempt: 1,
      kind: "generate_structured_text",
      input_checksum: "0".repeat(64),
      status: "completed",
      output: {
        markdown,
        claims: [
          {
            statement: "O control plane TikTok governa jornadas de creators.",
            node_id: "flowoff-tiktok-control-plane",
            relation_kind: "knowledge",
            source_refs: ["tiktok-platform-architecture"],
          },
          {
            statement: "FlowPay oferece conhecimento financeiro relevante para o desenho.",
            node_id: "flowpay",
            relation_kind: flowpayRelation,
            source_refs: ["flowpay-system-context"],
          },
        ],
      },
      started_at: NOW,
      finished_at: NOW,
    },
    evidence: {
      evidence_id: "evidence-1",
      action_id: "action-1",
      kind: "structured_output",
      checksum_sha256: "0".repeat(64),
      checks: CRITERIA.map((criterion) => ({ criterion, passed: true, observed: markdown })),
      observed_at: NOW,
    },
  };
}

function review(taskId) {
  return {
    schema_version: "pilot.v1",
    task_id: taskId,
    verdict: "PASS",
    findings: [],
    reviewed_at: NOW,
  };
}

function createHarness(intent, { discovery = discoveryResponse(), relation = "knowledge_candidate", retrievalError } = {}) {
  const trace = [];
  const entries = [
    retrievedEntry(TIKTOK_SOURCE, "TikTok control plane owns creator journey architecture."),
    retrievedEntry(FLOWPAY_SOURCE, "FlowPay is a financial settlement capability in the NEO stack."),
  ];
  const worker = new ScriptedWorker(
    [task(intent), plan(intent.task_id), execution(intent.task_id, relation), review(intent.task_id)],
    trace
  );
  const discoveryGateway = new DiscoveryGatewayStub(discovery, trace);
  const contextRetriever = new RetrieverStub(entries, trace, retrievalError);
  const loop = new PilotLoop({
    worker,
    roles: createPilotRoles({ providerId: "test", documents: [] }),
    memoryGateway: new MemoryGatewayStub(trace),
    discoveryGateway,
    contextRetriever,
    now: () => new Date(NOW),
  });
  return { trace, worker, discoveryGateway, contextRetriever, loop };
}

test("E2E TikTok -> Orchestrator -> selective retrieval -> Guardian", async () => {
  const intent = prepareWeekIntent(intentInput("context-e2e"), () => new Date(NOW));
  const harness = createHarness(intent);

  const result = await harness.loop.run(intent, { doctrineVersion: "context-doctrine" });
  const state = await harness.worker.getContext(intent.task_id);

  assert.equal(result.status, "APPROVED");
  assert.deepEqual(harness.trace, [
    "context_discovery",
    "selective_context_retrieval",
    "memory_recall",
    "operator",
    "plan",
    "execution_1",
    "review_1",
    "memory_persist",
  ]);
  assert.equal(state.intent.current_node, "flowoff-tiktok-control-plane");
  assert.equal(state.discovery.discovery_status, "completed");
  assert.equal(state.discovery.registry_checksum, "2".repeat(64));
  assert.deepEqual(
    state.discovery.nodes_considered.map((node) => [node.node_id, node.relation_kind]),
    [
      ["flowoff-tiktok-control-plane", "knowledge"],
      ["flowpay", "knowledge_candidate"],
    ]
  );
  assert.deepEqual(
    state.discovery.sources_selected.map((item) => item.source_id),
    ["tiktok-platform-architecture", "flowpay-system-context"]
  );
  assert.deepEqual(
    state.discovery.sources_retrieved.map((item) => item.source_id),
    ["tiktok-platform-architecture", "flowpay-system-context"]
  );
  assert.equal(state.task_context.sources.length, 2);
  assert.match(result.artifact.markdown, /Não há evidência de integração/);
  assert.equal(result.artifact.claims[1].relation_kind, "knowledge_candidate");

  if (process.env.NEO_E2E_TRACE === "1") {
    process.stdout.write(`${JSON.stringify({ trace: harness.trace, discovery: state.discovery, approval: state.approval }, null, 2)}\n`);
  }
});

test("restart reuses persisted discovery and retrieved context", async () => {
  const intent = prepareWeekIntent(intentInput("context-restart"), () => new Date(NOW));
  const first = createHarness(intent);
  await first.worker.setContextField(intent.task_id, "intent", intent);
  await first.worker.setContextField(intent.task_id, "runtime", {
    status: "RECEIVED",
    attempt: 0,
    doctrine_version: "context-doctrine",
    memory_status: "pending",
    started_at: NOW,
    updated_at: NOW,
  });
  const firstPreflight = await first.loop.run(intent);
  assert.equal(firstPreflight.status, "APPROVED");

  const state = await first.worker.getContext(intent.task_id);
  delete state.task;
  delete state.plan;
  delete state.execution_1;
  delete state.review_1;
  delete state.guardian_1;
  delete state.approval;
  delete state.memory;
  first.worker.contexts.set(intent.task_id, state);
  first.worker.responses = [task(intent), plan(intent.task_id), execution(intent.task_id), review(intent.task_id)];
  const noRepeatDiscovery = new DiscoveryGatewayStub(new Error("must not run"));
  const noRepeatRetriever = new RetrieverStub([], [], new Error("must not run"));
  const resumed = new PilotLoop({
    worker: first.worker,
    roles: createPilotRoles({ providerId: "test", documents: [] }),
    memoryGateway: new MemoryGatewayStub(),
    discoveryGateway: noRepeatDiscovery,
    contextRetriever: noRepeatRetriever,
    now: () => new Date(NOW),
  });

  const result = await resumed.run(intent);
  assert.equal(result.status, "APPROVED");
  assert.equal(noRepeatDiscovery.calls, 0);
  assert.equal(noRepeatRetriever.calls, 0);
});

test("registry unavailable is persisted as unavailable and blocks before Operator", async () => {
  const intent = prepareWeekIntent(intentInput("context-unavailable"), () => new Date(NOW));
  const harness = createHarness(intent, { discovery: new Error("registry_unavailable") });

  const result = await harness.loop.run(intent);
  const state = await harness.worker.getContext(intent.task_id);

  assert.equal(result.status, "NEEDS_HUMAN");
  assert.equal(result.approval.authority_rule, "CONTEXT_DISCOVERY_REQUIRED_UNAVAILABLE");
  assert.equal(state.discovery.discovery_status, "unavailable");
  assert.equal(state.discovery.registry_checksum, null);
  assert.deepEqual(harness.trace, ["context_discovery", "memory_persist"]);
});

test("knowledge candidate cannot be promoted to an integration capability", async () => {
  const intent = prepareWeekIntent(intentInput("context-overclaim"), () => new Date(NOW));
  const harness = createHarness(intent, { relation: "capability" });

  const result = await harness.loop.run(intent);

  assert.equal(result.status, "NEEDS_HUMAN");
  assert.equal(result.approval.authority_rule, "CONTEXT_RELATION_OVERCLAIM");
});

test("retrieval above budget is persisted as blocked", async () => {
  const intent = prepareWeekIntent(intentInput("context-budget"), () => new Date(NOW));
  const budgetError = new Error("Retrieved context exceeds max_characters");
  budgetError.code = "CONTEXT_BUDGET_EXCEEDED";
  const harness = createHarness(intent, { retrievalError: budgetError });

  const result = await harness.loop.run(intent);
  const state = await harness.worker.getContext(intent.task_id);

  assert.equal(result.status, "NEEDS_HUMAN");
  assert.equal(result.approval.authority_rule, "CONTEXT_BUDGET_EXCEEDED");
  assert.equal(state.discovery.discovery_status, "blocked");
});

test("purely local task persists not_required with explicit reason", async () => {
  const intent = prepareWeekIntent(
    intentInput("context-local", {
      current_node: "neo-agent-react",
      intention: "Reformatar checklist local do PilotLoop",
    }),
    () => new Date(NOW)
  );
  const harness = createHarness(intent, { discovery: discoveryResponse({ status: "not_required" }) });
  const localExecution = execution(intent.task_id);
  localExecution.action.output.claims = [];
  harness.worker.responses = [task(intent), plan(intent.task_id), localExecution, review(intent.task_id)];

  const result = await harness.loop.run(intent);
  const state = await harness.worker.getContext(intent.task_id);

  assert.equal(result.status, "APPROVED");
  assert.equal(state.discovery.discovery_status, "not_required");
  assert.equal(state.discovery.not_required_reason, "no_cross_node_match");
  assert.equal(harness.contextRetriever.calls, 0);
});

test("private source token is transport-only and never enters retrieved evidence", async () => {
  let observedHeaders;
  const retriever = new SelectiveContextRetriever({
    token: "test-read-only-token",
    fetchImpl: async (_url, options) => {
      observedHeaders = options.headers;
      return { ok: true, text: async () => "canonical private context" };
    },
  });

  const result = await retriever.retrieve({
    sources: [FLOWPAY_SOURCE],
    budget: { max_sources: 1, max_hops: 1, max_characters: 1000 },
  });

  assert.equal(observedHeaders.authorization, "Bearer test-read-only-token");
  assert.equal(observedHeaders.accept, "application/vnd.github.raw+json");
  assert.equal(JSON.stringify(result).includes("test-read-only-token"), false);
});

test("not_required without explicit reason is blocked before Operator", async () => {
  const intent = prepareWeekIntent(
    intentInput("context-missing-reason", {
      current_node: "neo-agent-react",
      intention: "Reformatar checklist local do PilotLoop",
    }),
    () => new Date(NOW)
  );
  const withoutReason = discoveryResponse({ status: "not_required" });
  delete withoutReason.not_required_reason;
  const harness = createHarness(intent, { discovery: withoutReason });

  const result = await harness.loop.run(intent);

  assert.equal(result.status, "NEEDS_HUMAN");
  assert.equal(result.approval.authority_rule, "CONTEXT_NOT_REQUIRED_JUSTIFICATION_MISSING");
  assert.deepEqual(harness.trace, ["context_discovery", "memory_persist"]);
});
