const IFTTT_AUTHORITY_RULES = new Set([
  "REVIEW_BLOCK",
  "ACTION_FAILED_AFTER_RETRY",
  "REVIEW_REVISE_AFTER_RETRY",
  "MISSING_OR_FAILED_CRITERIA_AFTER_RETRY",
  "MAX_ATTEMPTS_EXHAUSTED",
  "BLOCKED_CONFIGURATION",
  "PILOT_EXECUTION_ERROR",
]);

function alertPayload(result) {
  return {
    title: `Agent requer atenção: ${result.task_id}`,
    summary: result.approval.authority_rule,
    task_id: result.task_id,
    decision: result.status,
    authority_rule: result.approval.authority_rule,
  };
}

export class NotificationRouter {
  constructor({ store, providerRegistry }) {
    this.store = store;
    this.providerRegistry = providerRegistry;
  }

  async routeApproval(result) {
    if (!["NEEDS_HUMAN", "REJECTED"].includes(result.status)) return [];
    const channels = ["telegram"];
    if (
      IFTTT_AUTHORITY_RULES.has(result.approval.authority_rule) &&
      this.providerRegistry.get("ifttt").isEnabled()
    ) {
      channels.push("ifttt");
    }

    const ids = [];
    for (const channel of channels) {
      const id = await this.store.enqueueNotification({
        taskId: result.task_id,
        kind: "agent_alert",
        channel,
        dedupeKey: `${result.task_id}:${result.status}:${result.approval.authority_rule}`,
        payload: alertPayload(result),
      });
      if (id) ids.push(id);
    }
    return ids;
  }

  async createDigest({ kind, tasks, periodKey }) {
    if (!tasks.length) return null;
    const counts = tasks.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {});
    return this.store.enqueueNotification({
      taskId: null,
      kind,
      channel: "resend",
      dedupeKey: `${kind}:${periodKey}`,
      payload: {
        title: kind === "weekly_report" ? "Fechamento semanal do Agent" : "Resumo diário do Agent",
        summary: `${tasks.length} tarefa(s) processada(s).`,
        period: periodKey,
        counts,
        tasks: tasks.map((task) => ({
          task_id: task.task_id,
          status: task.status,
          attempt: task.attempt,
        })),
      },
    });
  }
}

export { IFTTT_AUTHORITY_RULES };
