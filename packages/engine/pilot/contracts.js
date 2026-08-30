import { createHash } from "node:crypto";
import { z } from "zod";

export const TaskIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const EffectSchema = z.enum([
  "none",
  "local_state",
  "filesystem",
  "network",
  "git",
  "production",
]);

export const RawWeekIntentSchema = z.object({
  task_id: TaskIdSchema,
  intention: z.string().min(1),
  acceptance_criteria: z.array(z.string().min(1)).min(1),
  constraints: z.array(z.string().min(1)).default([]),
  source: z.object({
    type: z.enum(["manual", "notion"]),
    ref: z.string().min(1),
    revision: z.string().min(1).optional(),
  }),
});

export const WeekIntentSchema = RawWeekIntentSchema.extend({
  source: RawWeekIntentSchema.shape.source.extend({
    checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    captured_at: z.string().datetime(),
  }),
});

export const TaskSchema = z.object({
  schema_version: z.literal("pilot.v1"),
  task_id: TaskIdSchema,
  objective: z.string().min(1),
  acceptance_criteria: z.array(z.string().min(1)).min(1),
  source: WeekIntentSchema.shape.source,
  scope: z.object({
    allowed_effects: z.array(EffectSchema).min(1),
    forbidden_targets: z.array(z.string().min(1)).min(1),
  }),
  risk: z.enum(["low", "medium", "high"]),
  max_attempts: z.literal(2),
  created_at: z.string().datetime(),
});

export const PlanSchema = z.object({
  schema_version: z.literal("pilot.v1"),
  task_id: TaskIdSchema,
  steps: z
    .array(
      z.object({
        id: z.string().min(1),
        instruction: z.string().min(1),
        effect: EffectSchema,
        expected_evidence: z.string().min(1),
      })
    )
    .min(1)
    .max(3),
  assumptions: z.array(z.string()),
  created_at: z.string().datetime(),
});

export const ExecutionSchema = z.object({
  schema_version: z.literal("pilot.v1"),
  task_id: TaskIdSchema,
  action: z.object({
    action_id: z.string().min(1),
    step_id: z.string().min(1),
    attempt: z.number().int().min(1).max(2),
    kind: z.literal("generate_structured_text"),
    input_checksum: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(["completed", "failed"]),
    output: z.record(z.unknown()),
    started_at: z.string().datetime(),
    finished_at: z.string().datetime(),
  }),
  evidence: z.object({
    evidence_id: z.string().min(1),
    action_id: z.string().min(1),
    kind: z.literal("structured_output"),
    checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    checks: z
      .array(
        z.object({
          criterion: z.string().min(1),
          passed: z.boolean(),
          observed: z.string().min(1),
        })
      )
      .min(1),
    observed_at: z.string().datetime(),
  }),
});

export const ReviewSchema = z.object({
  schema_version: z.literal("pilot.v1"),
  task_id: TaskIdSchema,
  verdict: z.enum(["PASS", "REVISE", "BLOCK"]),
  findings: z.array(
    z.object({
      priority: z.enum(["P0", "P1", "P2", "P3"]),
      evidence_ref: z.string().min(1),
      message: z.string().min(1),
    })
  ),
  reviewed_at: z.string().datetime(),
});

export const ApprovalSchema = z.object({
  schema_version: z.literal("pilot.v1"),
  task_id: TaskIdSchema,
  decision: z.enum(["APPROVED", "RETRY", "NEEDS_HUMAN", "REJECTED"]),
  decided_by: z.enum(["guardian", "human"]),
  authority_rule: z.string().min(1),
  review_ref: z.string().min(1).nullable(),
  decided_at: z.string().datetime(),
});

export function stableChecksum(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function prepareWeekIntent(raw, now = () => new Date()) {
  const parsed = RawWeekIntentSchema.parse(raw);
  const checksumPayload = {
    intention: parsed.intention,
    acceptance_criteria: parsed.acceptance_criteria,
    constraints: parsed.constraints,
    source: parsed.source,
  };
  return WeekIntentSchema.parse({
    ...parsed,
    source: {
      ...parsed.source,
      checksum_sha256: stableChecksum(checksumPayload),
      captured_at: now().toISOString(),
    },
  });
}
