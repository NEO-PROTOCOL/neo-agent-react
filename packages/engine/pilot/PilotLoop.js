import {
  ApprovalSchema,
  ExecutionSchema,
  PlanSchema,
  ReviewSchema,
  TaskSchema,
  WeekIntentSchema,
  stableChecksum,
} from "./contracts.js";

const PILOT_EFFECTS = new Set(["none", "local_state"]);
const REQUIRED_FORBIDDEN_TARGETS = [
  "production",
  "git",
  "filesystem",
  "network",
  "secrets",
  "growth",
  "tiktok",
  "nox",
  "flowpay",
];

class PilotError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PilotError";
    this.code = code;
  }
}

function assertRealProviderResult(result, role) {
  if (result?.mode === "fallback") {
    throw new PilotError(
      "BLOCKED_CONFIGURATION",
      `Provider indisponivel para o papel ${role}`
    );
  }
}

function assertTaskBoundary(task, intent) {
  if (task.task_id !== intent.task_id) {
    throw new PilotError("OPERATOR_SCOPE_DRIFT", "Operator alterou task_id");
  }
  if (
    task.source.type !== intent.source.type ||
    task.source.ref !== intent.source.ref ||
    task.source.revision !== intent.source.revision ||
    task.source.checksum_sha256 !== intent.source.checksum_sha256 ||
    task.source.captured_at !== intent.source.captured_at
  ) {
    throw new PilotError("OPERATOR_SCOPE_DRIFT", "Operator alterou source snapshot");
  }
  if (JSON.stringify(task.acceptance_criteria) !== JSON.stringify(intent.acceptance_criteria)) {
    throw new PilotError("OPERATOR_SCOPE_DRIFT", "Operator alterou acceptance_criteria");
  }
  if (task.scope.allowed_effects.some((effect) => !PILOT_EFFECTS.has(effect))) {
    throw new PilotError("OPERATOR_SCOPE_DRIFT", "Operator ampliou allowed_effects");
  }
  const forbidden = new Set(task.scope.forbidden_targets.map((target) => target.toLowerCase()));
  const missing = REQUIRED_FORBIDDEN_TARGETS.filter((target) => !forbidden.has(target));
  if (missing.length) {
    throw new PilotError(
      "OPERATOR_SCOPE_DRIFT",
      `Operator omitiu forbidden_targets obrigatorios: ${missing.join(", ")}`
    );
  }
}

function assessPlan(task, plan) {
  if (plan.task_id !== task.task_id) return "PLAN_TASK_MISMATCH";
  if (task.risk !== "low") return "TASK_RISK_NOT_LOW";
  const allowed = new Set(task.scope.allowed_effects);
  if (plan.steps.some((step) => !PILOT_EFFECTS.has(step.effect))) {
    return "PLAN_EXTERNAL_EFFECT";
  }
  if (plan.steps.some((step) => !allowed.has(step.effect))) {
    return "PLAN_EFFECT_NOT_ALLOWED";
  }
  return null;
}

export function decideGuardian({ task, plan, execution, review, attempt }) {
  const planIssue = assessPlan(task, plan);
  if (planIssue) return { decision: "NEEDS_HUMAN", rule: planIssue };
  if (execution.action.status !== "completed") {
    return attempt < task.max_attempts
      ? { decision: "RETRY", rule: "ACTION_FAILED_RETRY_ONCE" }
      : { decision: "NEEDS_HUMAN", rule: "ACTION_FAILED_AFTER_RETRY" };
  }
  if (review.verdict === "BLOCK") {
    return { decision: "NEEDS_HUMAN", rule: "REVIEW_BLOCK" };
  }
  if (review.verdict === "REVISE") {
    return attempt < task.max_attempts
      ? { decision: "RETRY", rule: "REVIEW_REVISE_RETRY_ONCE" }
      : { decision: "NEEDS_HUMAN", rule: "REVIEW_REVISE_AFTER_RETRY" };
  }
  if (review.findings.length > 0) {
    return { decision: "NEEDS_HUMAN", rule: "PASS_WITH_FINDINGS" };
  }

  const checksByCriterion = new Map(
    execution.evidence.checks.map((check) => [check.criterion, check])
  );
  const criteriaPass = task.acceptance_criteria.every(
    (criterion) => checksByCriterion.get(criterion)?.passed === true
  );
  if (!criteriaPass) {
    return attempt < task.max_attempts
      ? { decision: "RETRY", rule: "MISSING_OR_FAILED_CRITERIA_RETRY_ONCE" }
      : { decision: "NEEDS_HUMAN", rule: "MISSING_OR_FAILED_CRITERIA_AFTER_RETRY" };
  }

  return { decision: "APPROVED", rule: "LOW_RISK_LOCAL_EVIDENCE_PASS" };
}

export class PilotLoop {
  constructor({ worker, roles, memoryGateway, now = () => new Date() }) {
    this.worker = worker;
    this.roles = roles;
    this.memoryGateway = memoryGateway;
    this.now = now;
  }

  async run(rawIntent, { doctrineVersion } = {}) {
    const intent = WeekIntentSchema.parse(rawIntent);
    const existing = await this.worker.getContext(intent.task_id);
    if (Object.keys(existing).length > 0) {
      throw new PilotError(
        "TASK_ALREADY_EXISTS",
        `Task ${intent.task_id} ja possui estado no Redis`
      );
    }

    await this.#write(intent.task_id, "intent", intent);
    await this.#write(intent.task_id, "runtime", {
      status: "RECEIVED",
      attempt: 0,
      doctrine_version: doctrineVersion || null,
      memory_status: "pending",
      started_at: this.now().toISOString(),
      updated_at: this.now().toISOString(),
    });

    let lastReviewRef = null;
    try {
      const memory = await this.memoryGateway.recall({
        query: intent.intention,
        topic: "neo-agent-react",
      });
      await this.#write(intent.task_id, "memory", memory);
      await this.#status(intent.task_id, "OPERATING", 0, memory.status);

      const operatorRaw = await this.worker.executeNode(intent.task_id, this.roles.operator);
      assertRealProviderResult(operatorRaw, "Operator");
      const task = TaskSchema.parse(operatorRaw);
      assertTaskBoundary(task, intent);
      task.created_at = this.now().toISOString();
      await this.#write(intent.task_id, "task", task);
      await this.#status(intent.task_id, "PLANNING", 0, memory.status);

      const planRaw = await this.worker.executeNode(intent.task_id, this.roles.planner);
      assertRealProviderResult(planRaw, "Planner");
      const plan = PlanSchema.parse(planRaw);
      plan.created_at = this.now().toISOString();
      await this.#write(intent.task_id, "plan", plan);

      const planIssue = assessPlan(task, plan);
      if (planIssue) {
        return this.#finalize({
          intent,
          decision: "NEEDS_HUMAN",
          rule: planIssue,
          reviewRef: null,
          memoryKind: "failure",
        });
      }

      for (let attempt = 1; attempt <= task.max_attempts; attempt += 1) {
        await this.#status(intent.task_id, "EXECUTING", attempt, memory.status);
        const executionStartedAt = this.now().toISOString();
        const executionRaw = await this.worker.executeNode(
          intent.task_id,
          this.roles.executor(attempt)
        );
        assertRealProviderResult(executionRaw, "Executor");
        const execution = ExecutionSchema.parse(executionRaw);
        this.#assertExecutionBoundary(task, plan, execution, attempt);
        execution.action.input_checksum = stableChecksum({ task, plan, attempt });
        execution.evidence.checksum_sha256 = stableChecksum(execution.action.output);
        execution.action.started_at = executionStartedAt;
        execution.action.finished_at = this.now().toISOString();
        execution.evidence.observed_at = execution.action.finished_at;
        await this.#write(intent.task_id, `execution_${attempt}`, execution);

        await this.#status(intent.task_id, "REVIEWING", attempt, memory.status);
        const reviewRaw = await this.worker.executeNode(
          intent.task_id,
          this.roles.reviewer(attempt)
        );
        assertRealProviderResult(reviewRaw, "Reviewer");
        const review = ReviewSchema.parse(reviewRaw);
        this.#assertReviewBoundary(task, execution, review);
        review.reviewed_at = this.now().toISOString();
        await this.#write(intent.task_id, `review_${attempt}`, review);
        lastReviewRef = `review_${attempt}`;

        const guardian = decideGuardian({ task, plan, execution, review, attempt });
        const guardianRecord = this.#approval(
          intent.task_id,
          guardian.decision,
          guardian.rule,
          lastReviewRef
        );
        await this.#write(intent.task_id, `guardian_${attempt}`, guardianRecord);

        if (guardian.decision === "RETRY") {
          await this.#status(intent.task_id, "RETRY_PENDING", attempt, memory.status);
          continue;
        }

        return this.#finalize({
          intent,
          decision: guardian.decision,
          rule: guardian.rule,
          reviewRef: lastReviewRef,
          memoryKind: guardian.decision === "APPROVED" ? "decision" : "failure",
        });
      }

      return this.#finalize({
        intent,
        decision: "NEEDS_HUMAN",
        rule: "MAX_ATTEMPTS_EXHAUSTED",
        reviewRef: lastReviewRef,
        memoryKind: "failure",
      });
    } catch (error) {
      const code = error instanceof PilotError ? error.code : "PILOT_EXECUTION_ERROR";
      const message = error instanceof Error ? error.message : "Falha desconhecida no piloto";
      await this.#write(intent.task_id, "error", { code, message, at: this.now().toISOString() });
      return this.#finalize({
        intent,
        decision: "NEEDS_HUMAN",
        rule: code,
        reviewRef: lastReviewRef,
        memoryKind: "failure",
        error: { code, message },
      });
    }
  }

  #assertExecutionBoundary(task, plan, execution, attempt) {
    if (execution.task_id !== task.task_id) {
      throw new PilotError("EXECUTION_TASK_MISMATCH", "Executor alterou task_id");
    }
    if (execution.action.attempt !== attempt) {
      throw new PilotError("EXECUTION_ATTEMPT_MISMATCH", "Executor alterou attempt");
    }
    if (!plan.steps.some((step) => step.id === execution.action.step_id)) {
      throw new PilotError("EXECUTION_STEP_MISMATCH", "Executor usou step_id fora do Plan");
    }
    if (execution.evidence.action_id !== execution.action.action_id) {
      throw new PilotError("EVIDENCE_ACTION_MISMATCH", "Evidence nao referencia Action");
    }
    if (
      execution.evidence.checks.some(
        (check) => check.observed !== execution.action.output.markdown
      )
    ) {
      throw new PilotError(
        "EVIDENCE_OUTPUT_MISMATCH",
        "Evidence nao corresponde ao markdown produzido"
      );
    }
  }

  #assertReviewBoundary(task, execution, review) {
    if (review.task_id !== task.task_id) {
      throw new PilotError("REVIEW_TASK_MISMATCH", "Reviewer alterou task_id");
    }
    if (
      review.findings.some(
        (finding) => finding.evidence_ref !== execution.evidence.evidence_id
      )
    ) {
      throw new PilotError("REVIEW_EVIDENCE_MISMATCH", "Review referencia evidence desconhecida");
    }
  }

  #approval(taskId, decision, rule, reviewRef) {
    return ApprovalSchema.parse({
      schema_version: "pilot.v1",
      task_id: taskId,
      decision,
      decided_by: "guardian",
      authority_rule: rule,
      review_ref: reviewRef,
      decided_at: this.now().toISOString(),
    });
  }

  async #finalize({ intent, decision, rule, reviewRef, memoryKind, error }) {
    const approval = this.#approval(intent.task_id, decision, rule, reviewRef);
    await this.#write(intent.task_id, "approval", approval);

    const memory = await this.memoryGateway.persist({
      kind: memoryKind,
      topic: "neo-agent-react",
      sessionId: intent.task_id,
      content: `Pilot ${intent.task_id}: ${decision} por ${rule}.`,
    });
    await this.#status(
      intent.task_id,
      decision,
      reviewRef === "review_2" ? 2 : reviewRef ? 1 : 0,
      memory.status
    );

    return {
      ok: decision === "APPROVED",
      task_id: intent.task_id,
      status: decision,
      approval,
      memory_status: memory.status,
      ...(error ? { error } : {}),
    };
  }

  async #status(taskId, status, attempt, memoryStatus) {
    const current = (await this.worker.getContext(taskId)).runtime || {};
    await this.#write(taskId, "runtime", {
      ...current,
      status,
      attempt,
      memory_status: memoryStatus,
      updated_at: this.now().toISOString(),
    });
  }

  async #write(taskId, key, value) {
    await this.worker.setContextField(taskId, key, value);
  }
}
