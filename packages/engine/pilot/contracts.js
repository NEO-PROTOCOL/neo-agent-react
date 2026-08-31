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
export const RelationKindSchema = z.enum([
  "runtime",
  "infrastructure",
  "capability",
  "knowledge",
  "architectural_influence",
  "knowledge_candidate",
]);

export const RawWeekIntentSchema = z.object({
  task_id: TaskIdSchema,
  current_node: TaskIdSchema.default("neo-agent-react"),
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
  current_node: TaskIdSchema.default("neo-agent-react"),
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
    output: z.object({
      markdown: z.string().min(1),
      claims: z
        .array(
          z.object({
            statement: z.string().min(1),
            node_id: TaskIdSchema,
            relation_kind: RelationKindSchema,
            source_refs: z.array(z.string().min(1)).min(1),
          })
        )
        .default([]),
    }),
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

const DiscoveryBudgetSchema = z.object({
  max_nodes: z.number().int().min(1),
  max_sources: z.number().int().min(1),
  max_hops: z.number().int().min(1),
  max_characters: z.number().int().min(1),
  used_nodes: z.number().int().min(0),
  used_sources: z.number().int().min(0),
  used_hops: z.number().int().min(0),
  used_characters: z.number().int().min(0),
});

export const OrchestratorDiscoveryResponseSchema = z.object({
  schema_version: z.literal("context.discovery.v1"),
  status: z.enum(["completed", "not_required"]),
  query: z.string().min(1),
  current_node: TaskIdSchema,
  registry_checksum: z.string().regex(/^[a-f0-9]{64}$/),
  cross_domain_required: z.boolean(),
  nodes_considered: z.array(
    z.object({
      node_id: TaskIdSchema,
      score: z.number().nonnegative(),
      relation_kind: RelationKindSchema,
      reasons: z.array(z.string()),
    })
  ),
  selected_sources: z.array(
    z.object({
      source_id: z.string().min(1),
      node_id: TaskIdSchema,
      kind: z.literal("repository-file"),
      repository: z.string().url(),
      ref: z.string().min(1),
      path: z.string().min(1),
      authority: z.enum(["canonical", "derived", "historical"]),
      topics: z.array(z.string()),
      relation_kind: RelationKindSchema,
      match_reasons: z.array(z.string()),
    })
  ),
  not_required_reason: z.string().min(1).optional(),
  budget: DiscoveryBudgetSchema,
});

export const DiscoveryEvidenceSchema = z.object({
  schema_version: z.literal("context.discovery.evidence.v1"),
  discovery_status: z.enum(["completed", "not_required", "unavailable", "blocked"]),
  required: z.boolean(),
  current_node: TaskIdSchema,
  registry_checksum: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  nodes_considered: z.array(
    z.object({
      node_id: TaskIdSchema,
      score: z.number().nonnegative(),
      relation_kind: RelationKindSchema,
      reasons: z.array(z.string()),
    })
  ),
  sources_selected: z.array(
    z.object({
      source_id: z.string().min(1),
      node_id: TaskIdSchema,
      kind: z.literal("repository-file"),
      repository: z.string().url(),
      ref: z.string().min(1),
      path: z.string().min(1),
      authority: z.enum(["canonical", "derived", "historical"]),
      topics: z.array(z.string()),
      relation_kind: RelationKindSchema,
      match_reasons: z.array(z.string()),
    })
  ),
  sources_retrieved: z.array(
    z.object({
      source_id: z.string().min(1),
      node_id: TaskIdSchema,
      checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/),
      characters: z.number().int().positive(),
      relation_kind: RelationKindSchema,
    })
  ),
  not_required_reason: z.string().min(1).nullable(),
  unavailable_reason: z.string().min(1).nullable(),
  budget: DiscoveryBudgetSchema,
  discovered_at: z.string().datetime(),
});

export const TaskContextSchema = z.object({
  schema_version: z.literal("context.task.v1"),
  current_node: TaskIdSchema,
  registry_checksum: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  sources: z.array(
    z.object({
      source_id: z.string().min(1),
      node_id: TaskIdSchema,
      relation_kind: RelationKindSchema,
      authority: z.enum(["canonical", "derived", "historical"]),
      repository: z.string().url(),
      ref: z.string().min(1),
      path: z.string().min(1),
      checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/),
      characters: z.number().int().positive(),
      content: z.string().min(1),
    })
  ),
  created_at: z.string().datetime(),
});

export function stableChecksum(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function prepareWeekIntent(raw, now = () => new Date()) {
  const parsed = RawWeekIntentSchema.parse(raw);
  const checksumPayload = {
    current_node: parsed.current_node,
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
