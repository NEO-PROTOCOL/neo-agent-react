const sourceSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["manual", "notion"] },
    ref: { type: "string" },
    revision: { type: "string" },
    checksum_sha256: { type: "string" },
    captured_at: { type: "string" },
  },
  required: ["type", "ref", "checksum_sha256", "captured_at"],
};

const taskOutputSchema = {
  type: "object",
  properties: {
    schema_version: { type: "string", enum: ["pilot.v1"] },
    task_id: { type: "string" },
    objective: { type: "string" },
    acceptance_criteria: { type: "array", items: { type: "string" } },
    source: sourceSchema,
    scope: {
      type: "object",
      properties: {
        allowed_effects: { type: "array", items: { type: "string" } },
        forbidden_targets: { type: "array", items: { type: "string" } },
      },
      required: ["allowed_effects", "forbidden_targets"],
    },
    risk: { type: "string", enum: ["low", "medium", "high"] },
    max_attempts: { type: "integer" },
    created_at: { type: "string" },
  },
  required: [
    "schema_version",
    "task_id",
    "objective",
    "acceptance_criteria",
    "source",
    "scope",
    "risk",
    "max_attempts",
    "created_at",
  ],
};

const planOutputSchema = {
  type: "object",
  properties: {
    schema_version: { type: "string", enum: ["pilot.v1"] },
    task_id: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          instruction: { type: "string" },
          effect: {
            type: "string",
            enum: ["none", "local_state", "filesystem", "network", "git", "production"],
          },
          expected_evidence: { type: "string" },
        },
        required: ["id", "instruction", "effect", "expected_evidence"],
      },
    },
    assumptions: { type: "array", items: { type: "string" } },
    created_at: { type: "string" },
  },
  required: ["schema_version", "task_id", "steps", "assumptions", "created_at"],
};

const executionOutputSchema = {
  type: "object",
  properties: {
    schema_version: { type: "string", enum: ["pilot.v1"] },
    task_id: { type: "string" },
    action: {
      type: "object",
      properties: {
        action_id: { type: "string" },
        step_id: { type: "string" },
        attempt: { type: "integer" },
        kind: { type: "string", enum: ["generate_structured_text"] },
        input_checksum: { type: "string" },
        status: { type: "string", enum: ["completed", "failed"] },
        output: { type: "object" },
        started_at: { type: "string" },
        finished_at: { type: "string" },
      },
      required: [
        "action_id",
        "step_id",
        "attempt",
        "kind",
        "input_checksum",
        "status",
        "output",
        "started_at",
        "finished_at",
      ],
    },
    evidence: {
      type: "object",
      properties: {
        evidence_id: { type: "string" },
        action_id: { type: "string" },
        kind: { type: "string", enum: ["structured_output"] },
        checksum_sha256: { type: "string" },
        checks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              criterion: { type: "string" },
              passed: { type: "boolean" },
              observed: { type: "string" },
            },
            required: ["criterion", "passed", "observed"],
          },
        },
        observed_at: { type: "string" },
      },
      required: [
        "evidence_id",
        "action_id",
        "kind",
        "checksum_sha256",
        "checks",
        "observed_at",
      ],
    },
  },
  required: ["schema_version", "task_id", "action", "evidence"],
};

const reviewOutputSchema = {
  type: "object",
  properties: {
    schema_version: { type: "string", enum: ["pilot.v1"] },
    task_id: { type: "string" },
    verdict: { type: "string", enum: ["PASS", "REVISE", "BLOCK"] },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
          evidence_ref: { type: "string" },
          message: { type: "string" },
        },
        required: ["priority", "evidence_ref", "message"],
      },
    },
    reviewed_at: { type: "string" },
  },
  required: ["schema_version", "task_id", "verdict", "findings", "reviewed_at"],
};

function baseAgent({ id, role, mission, constraints, requiredContextKeys, outputSchema, provider }) {
  return {
    id,
    type: "agent",
    provider: provider.id,
    ...(provider.model ? { model: provider.model } : {}),
    config: { temperature: 0, maxTokens: 2048 },
    systemConfig: {
      role,
      mission,
      constraints,
      outputType: "json",
      outputSchema,
      requiredContextKeys,
      allowModelToolCalling: false,
      toolAllowlist: [],
      maxToolCalls: 1,
    },
    skills: [],
    documents: provider.documents,
  };
}

export function createPilotRoles({ providerId, model, documents = [] }) {
  const provider = { id: providerId, model, documents };

  return {
    operator: baseAgent({
      id: "operator",
      role: "Operator do piloto semanal",
      mission: "Normalizar a intencao semanal recebida em um Task pilot.v1 verificavel e estritamente local.",
      constraints: [
        "Preservar task_id e source exatamente como recebidos.",
        "Nao ampliar objetivo, criterios ou escopo.",
        "Permitir apenas effects none e local_state neste piloto.",
        "Marcar production, git, filesystem, network, secrets, growth, tiktok, nox e flowpay como forbidden_targets.",
        "Definir max_attempts como 2.",
        "Nao executar a tarefa; apenas normalizar Task.",
      ],
      requiredContextKeys: ["intent", "memory"],
      outputSchema: taskOutputSchema,
      provider,
    }),
    planner: baseAgent({
      id: "plan",
      role: "Planner do piloto semanal",
      mission: "Produzir o menor plano executavel que satisfaca o Task sem ampliar o escopo.",
      constraints: [
        "Criar de um a tres passos.",
        "Usar somente effects permitidos pelo Task.",
        "Declarar evidencia esperada por passo.",
        "Nao executar nenhuma acao.",
      ],
      requiredContextKeys: ["task", "memory"],
      outputSchema: planOutputSchema,
      provider,
    }),
    executor(attempt) {
      return baseAgent({
        id: `execution_${attempt}`,
        role: "Executor local sem tools externas",
        mission: `Executar o plano como geracao estruturada local. Esta e a tentativa ${attempt} de 2.`,
        constraints: [
          "Nao chamar tools, rede, filesystem, Git ou producao.",
          "Produzir somente output estruturado e evidencia observavel.",
          "Nao afirmar sucesso quando um criterio nao foi observado.",
          "Usar attempt igual ao numero da tentativa atual.",
        ],
        requiredContextKeys:
          attempt === 1
            ? ["task", "plan"]
            : ["task", "plan", "execution_1", "review_1"],
        outputSchema: executionOutputSchema,
        provider,
      });
    },
    reviewer(attempt) {
      return baseAgent({
        id: `review_${attempt}`,
        role: "Reviewer read-only e defect-first",
        mission: "Revisar a execucao contra Task, Plan e Evidence sem modificar a saida.",
        constraints: [
          "Retornar PASS somente se todos os criterios estiverem demonstrados pela evidencia.",
          "Usar REVISE para defeito corrigivel dentro do mesmo escopo.",
          "Usar BLOCK para risco, ampliacao de escopo ou evidencia nao confiavel.",
          "Findings devem ser concretos, acionaveis e referenciar evidence_id.",
          "Nao corrigir nem executar a tarefa.",
        ],
        requiredContextKeys: ["task", "plan", `execution_${attempt}`],
        outputSchema: reviewOutputSchema,
        provider,
      });
    },
  };
}
