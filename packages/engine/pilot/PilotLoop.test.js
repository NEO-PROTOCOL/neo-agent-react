import assert from "node:assert/strict";
import test from "node:test";
import { AgentRunner } from "../AgentRunner.js";
import { ProviderAdapter } from "../providers/ProviderAdapter.js";
import { ProviderRegistry } from "../providers/ProviderRegistry.js";
import { StateReducer } from "../StateReducer.js";
import { parseAgentConfig } from "../schemas/agentSchema.js";
import { prepareWeekIntent } from "./contracts.js";
import { PilotLoop } from "./PilotLoop.js";
import { createPilotRoles } from "./roles.js";

const NOW = "2026-08-30T12:00:00.000Z";
const CRITERION = "A saida possui exatamente um item Markdown contendo revisar backlog";

class ScriptedProviderAdapter extends ProviderAdapter {
  constructor(responses, { configured = true } = {}) {
    super({ id: "test" });
    this.responses = [...responses];
    this.configured = configured;
    this.calls = 0;
  }

  isConfigured() {
    return this.configured;
  }

  async execute() {
    this.calls += 1;
    if (!this.responses.length) throw new Error("Resposta de teste ausente");
    return { text: JSON.stringify(this.responses.shift()) };
  }
}

class MemoryWorker {
  constructor(runner) {
    this.runner = runner;
    this.reducer = new StateReducer();
    this.tasks = new Map();
  }

  async getContext(taskId) {
    return structuredClone(this.tasks.get(taskId) || {});
  }

  async setContextField(taskId, key, value) {
    const context = this.tasks.get(taskId) || {};
    context[key] = structuredClone(value);
    this.tasks.set(taskId, context);
  }

  async executeNode(taskId, rawConfig) {
    const config = parseAgentConfig(rawConfig);
    const context = await this.getContext(taskId);
    const reduced = this.reducer.reduce(
      context,
      config.systemConfig.requiredContextKeys || []
    );
    const result = await this.runner.execute(config, reduced);
    await this.setContextField(taskId, config.id, result);
    return result;
  }
}

class MemoryGatewayStub {
  constructor() {
    this.persisted = [];
  }

  async recall() {
    return { status: "ok", hits: [] };
  }

  async persist(input) {
    this.persisted.push(input);
    return { status: "ok", id: "memory-1" };
  }
}

function rawIntent(taskId) {
  return {
    task_id: taskId,
    intention: "Transformar segunda: revisar backlog em checklist Markdown.",
    acceptance_criteria: [CRITERION],
    constraints: ["Sem tools externas"],
    source: {
      type: "notion",
      ref: "notion://week/2026-08-31",
      revision: "2026-08-30T11:00:00.000Z",
    },
  };
}

function task(intent, risk = "low") {
  return {
    schema_version: "pilot.v1",
    task_id: intent.task_id,
    objective: "Gerar checklist semanal local.",
    acceptance_criteria: intent.acceptance_criteria,
    source: intent.source,
    scope: {
      allowed_effects: ["none", "local_state"],
      forbidden_targets: [
        "production",
        "git",
        "filesystem",
        "network",
        "secrets",
        "growth",
        "tiktok",
        "nox",
        "flowpay",
      ],
    },
    risk,
    max_attempts: 2,
    created_at: NOW,
  };
}

function plan(taskId, effect = "none") {
  return {
    schema_version: "pilot.v1",
    task_id: taskId,
    steps: [
      {
        id: "step-1",
        instruction: "Gerar uma checklist Markdown com um item.",
        effect,
        expected_evidence: "Output estruturado e criterio observado.",
      },
    ],
    assumptions: [],
    created_at: NOW,
  };
}

function execution(taskId, attempt, passed) {
  const markdown = passed ? "- [ ] revisar backlog" : "revisar backlog";
  return {
    schema_version: "pilot.v1",
    task_id: taskId,
    action: {
      action_id: `action-${attempt}`,
      step_id: "step-1",
      attempt,
      kind: "generate_structured_text",
      input_checksum: "0".repeat(64),
      status: "completed",
      output: {
        markdown,
      },
      started_at: NOW,
      finished_at: NOW,
    },
    evidence: {
      evidence_id: `evidence-${attempt}`,
      action_id: `action-${attempt}`,
      kind: "structured_output",
      checksum_sha256: "0".repeat(64),
      checks: [{ criterion: CRITERION, passed, observed: markdown }],
      observed_at: NOW,
    },
  };
}

function review(taskId, attempt, verdict) {
  return {
    schema_version: "pilot.v1",
    task_id: taskId,
    verdict,
    findings:
      verdict === "PASS"
        ? []
        : [
            {
              priority: "P2",
              evidence_ref: `evidence-${attempt}`,
              message: "A saida nao usa sintaxe de checklist Markdown.",
            },
          ],
    reviewed_at: NOW,
  };
}

function harness(responses, options = {}) {
  const adapter = new ScriptedProviderAdapter(responses, options);
  const registry = new ProviderRegistry([adapter]);
  const worker = new MemoryWorker(new AgentRunner({ providerRegistry: registry }));
  const memoryGateway = new MemoryGatewayStub();
  const roles = createPilotRoles({ providerId: "test", documents: [] });
  const loop = new PilotLoop({
    worker,
    roles,
    memoryGateway,
    now: () => new Date(NOW),
  });
  return { adapter, worker, memoryGateway, loop };
}

test("Operator normaliza Task e Guardian permite somente um retry antes de aprovar", async () => {
  const intent = prepareWeekIntent(rawIntent("pilot-retry"), () => new Date(NOW));
  const responses = [
    task(intent),
    plan(intent.task_id),
    execution(intent.task_id, 1, false),
    review(intent.task_id, 1, "REVISE"),
    execution(intent.task_id, 2, true),
    review(intent.task_id, 2, "PASS"),
  ];
  const { adapter, worker, memoryGateway, loop } = harness(responses);

  const result = await loop.run(intent, { doctrineVersion: "test-doctrine" });
  const state = await worker.getContext(intent.task_id);

  assert.equal(result.ok, true);
  assert.equal(result.status, "APPROVED");
  assert.deepEqual(result.artifact, { markdown: "- [ ] revisar backlog" });
  assert.equal(state.guardian_1.decision, "RETRY");
  assert.equal(state.approval.decision, "APPROVED");
  assert.equal(state.runtime.attempt, 2);
  assert.ok(state.operator);
  assert.ok(state.task);
  assert.ok(state.execution_2);
  assert.equal(state.execution_3, undefined);
  assert.equal(adapter.calls, 6);
  assert.equal(memoryGateway.persisted[0].kind, "decision");
});

test("Guardian interrompe plano com efeito externo antes do Executor", async () => {
  const intent = prepareWeekIntent(rawIntent("pilot-external-effect"), () => new Date(NOW));
  const responses = [task(intent), plan(intent.task_id, "filesystem")];
  const { adapter, worker, loop } = harness(responses);

  const result = await loop.run(intent);
  const state = await worker.getContext(intent.task_id);

  assert.equal(result.ok, false);
  assert.equal(result.status, "NEEDS_HUMAN");
  assert.equal(result.artifact, null);
  assert.equal(result.approval.authority_rule, "PLAN_EXTERNAL_EFFECT");
  assert.equal(state.execution_1, undefined);
  assert.equal(adapter.calls, 2);
});

test("Guardian exige humano para risco nao baixo antes do Executor", async () => {
  const intent = prepareWeekIntent(rawIntent("pilot-medium-risk"), () => new Date(NOW));
  const responses = [task(intent, "medium"), plan(intent.task_id)];
  const { adapter, worker, loop } = harness(responses);

  const result = await loop.run(intent);
  const state = await worker.getContext(intent.task_id);

  assert.equal(result.ok, false);
  assert.equal(result.status, "NEEDS_HUMAN");
  assert.equal(result.artifact, null);
  assert.equal(result.approval.authority_rule, "TASK_RISK_NOT_LOW");
  assert.equal(state.execution_1, undefined);
  assert.equal(adapter.calls, 2);
});

test("Guardian nao aceita evidencia que diverge do output real", async () => {
  const intent = prepareWeekIntent(rawIntent("pilot-evidence-mismatch"), () => new Date(NOW));
  const invalidExecution = execution(intent.task_id, 1, true);
  invalidExecution.action.output.markdown = "conteudo diferente";
  const responses = [task(intent), plan(intent.task_id), invalidExecution];
  const { adapter, worker, loop } = harness(responses);

  const result = await loop.run(intent);
  const state = await worker.getContext(intent.task_id);

  assert.equal(result.ok, false);
  assert.equal(result.status, "NEEDS_HUMAN");
  assert.equal(result.artifact, null);
  assert.equal(result.error.code, "EVIDENCE_OUTPUT_MISMATCH");
  assert.equal(state.review_1, undefined);
  assert.equal(adapter.calls, 3);
});

test("Fallback de provider nunca e tratado como execucao real", async () => {
  const intent = prepareWeekIntent(rawIntent("pilot-provider-missing"), () => new Date(NOW));
  const { adapter, worker, loop } = harness([], { configured: false });

  const result = await loop.run(intent);
  const state = await worker.getContext(intent.task_id);

  assert.equal(result.ok, false);
  assert.equal(result.status, "NEEDS_HUMAN");
  assert.equal(result.artifact, null);
  assert.equal(result.error.code, "BLOCKED_CONFIGURATION");
  assert.equal(state.approval.authority_rule, "BLOCKED_CONFIGURATION");
  assert.equal(adapter.calls, 0);
});

test("retomada pos-restart reutiliza checkpoints sem criar tentativa adicional", async () => {
  const intent = prepareWeekIntent(rawIntent("pilot-resume"), () => new Date(NOW));
  const { adapter, worker, loop } = harness([
    execution(intent.task_id, 2, true),
    review(intent.task_id, 2, "PASS"),
  ]);
  await worker.setContextField(intent.task_id, "intent", intent);
  await worker.setContextField(intent.task_id, "runtime", {
    status: "RETRY_PENDING",
    attempt: 1,
    doctrine_version: "test-doctrine",
    memory_status: "ok",
    started_at: NOW,
    updated_at: NOW,
  });
  await worker.setContextField(intent.task_id, "memory", { status: "ok", hits: [] });
  await worker.setContextField(intent.task_id, "task", task(intent));
  await worker.setContextField(intent.task_id, "plan", plan(intent.task_id));
  await worker.setContextField(intent.task_id, "execution_1", execution(intent.task_id, 1, false));
  await worker.setContextField(intent.task_id, "review_1", review(intent.task_id, 1, "REVISE"));
  await worker.setContextField(intent.task_id, "guardian_1", {
    schema_version: "pilot.v1",
    task_id: intent.task_id,
    decision: "RETRY",
    decided_by: "guardian",
    authority_rule: "REVIEW_REVISE_RETRY_ONCE",
    review_ref: "review_1",
    decided_at: NOW,
  });

  const result = await loop.run(intent, { doctrineVersion: "test-doctrine" });
  const state = await worker.getContext(intent.task_id);

  assert.equal(result.status, "APPROVED");
  assert.equal(state.runtime.attempt, 2);
  assert.equal(state.execution_3, undefined);
  assert.equal(adapter.calls, 2);
});
