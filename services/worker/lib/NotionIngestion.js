import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

// Explicit human recovery only. Never called by polling or by the model.
export function planControlledRetry(intent, state, requestId) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(requestId || "")) throw new Error("Invalid recovery request ID");
  const diagnostic = state[state.error?.diagnostic_ref];
  const executorJsonError = state.plan && !state.review_1 && (
    state.error?.message === "Falha: provider nao retornou JSON valido"
    || (diagnostic?.node_id === "execution_1" && /^(INVALID_JSON|INCOMPLETE_)/.test(diagnostic.failure_kind || ""))
  );
  const operatorBudgetError = state.controlled_retry && diagnostic?.node_id === "operator"
    && diagnostic.failure_kind === "INCOMPLETE_MAX_TOKENS" && !state.task;
  if (intent.source.type !== "notion" || !state.source_observation
    || (state.controlled_retry && !operatorBudgetError)
    || (!executorJsonError && !operatorBudgetError)
    || state.approval?.decision !== "NEEDS_HUMAN"
    || state.approval?.authority_rule !== "PILOT_EXECUTION_ERROR"
    || state.error?.code !== "PILOT_EXECUTION_ERROR") {
    throw new Error("Controlled recovery requires an original Notion PILOT_EXECUTION_ERROR");
  }
  const executionRevision = createHash("sha256").update(intent.task_id + "\0controlled-retry\0" + requestId).digest("hex");
  const retry = structuredClone(intent);
  retry.task_id = "notion-" + intent.source.metadata.page_id.replaceAll("-", "") + "-retry-" + executionRevision.slice(0, 24);
  retry.source.execution_revision = executionRevision;
  return { intent: retry, observation: structuredClone(state.source_observation), record: {
    event: "CONTROLLED_REPROCESSING_AUTHORIZED", request_id: requestId,
    authorized_by: "operator", parent_task_id: intent.task_id, task_id: retry.task_id,
    reason: "PILOT_EXECUTION_ERROR", source_checksum: intent.source.checksum_sha256,
    previous_approval: structuredClone(state.approval),
  } };
}

// Pure transition shared by PostgreSQL and the deterministic test store.
export function planNotionIngestion(incoming, previous) {
  const previousObservation = previous?.observation;
  if (previousObservation && incoming.source.revision < previousObservation.revision) {
    return { intent: previous.intent, claimed: false, changed: false, stale: true };
  }
  const claimed = !previous || incoming.source.checksum_sha256 !== previous.intent.source.checksum_sha256;
  const intent = claimed ? structuredClone(incoming) : previous.intent;
  if (claimed) {
    const revision = createHash("sha256").update(
      (previous?.intent.task_id || "initial") + "\0" + incoming.source.checksum_sha256
    ).digest("hex");
    intent.task_id = "notion-" + incoming.source.metadata.page_id.replaceAll("-", "") + "-" + revision.slice(0, 24);
    intent.source.execution_revision = revision;
  }
  const observation = {
    revision: incoming.source.revision,
    checksum_sha256: incoming.source.checksum_sha256,
    metadata: incoming.source.metadata,
  };
  const statusChanged = previousObservation &&
    previousObservation.metadata.human_state.status !== observation.metadata.human_state.status;
  return {
    intent, claimed, changed: !isDeepStrictEqual(previousObservation, observation), observation,
    statusEvent: statusChanged ? {
      event: "NOTION_STATUS_CHANGED", page_id: incoming.source.metadata.page_id,
      revision: incoming.source.revision,
      from: previousObservation.metadata.human_state.status,
      to: observation.metadata.human_state.status,
      executable_checksum: incoming.source.checksum_sha256,
      execution_requested: claimed,
    } : null,
  };
}
