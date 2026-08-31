import assert from "node:assert/strict";
import test from "node:test";
import { MemoryTaskStateStore } from "../lib/MemoryTaskStateStore.js";
import { NotificationRouter } from "../lib/NotificationRouter.js";
import { IFTTTProvider, NotificationProviderRegistry } from "../lib/NotificationProviders.js";

test("IFTTT fica disabled sem configuracao e nao faz request", async () => {
  let calls = 0;
  const provider = new IFTTTProvider({
    enabled: true,
    webhookKey: undefined,
    eventName: "neo_agent_alert",
    fetchImpl: async () => {
      calls += 1;
    },
  });
  const result = await provider.send({ kind: "agent_alert", payload: {} });
  assert.deepEqual(result, { status: "disabled" });
  assert.equal(calls, 0);
});

test("IFTTT envia somente value1/value2/value3 pelo endpoint Webhooks", async () => {
  let captured;
  const provider = new IFTTTProvider({
    enabled: true,
    webhookKey: "test_webhook_key",
    eventName: "neo_agent_alert",
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return { ok: true, status: 200 };
    },
  });
  const result = await provider.send({
    kind: "agent_alert",
    payload: { title: "Bloqueio", summary: "Revisao bloqueada", task_id: "task-1" },
  });
  assert.equal(result.status, "sent");
  assert.match(captured.url, /\/trigger\/neo_agent_alert\/with\/key\//);
  assert.deepEqual(JSON.parse(captured.init.body), {
    value1: "Bloqueio",
    value2: "Revisao bloqueada",
    value3: "task-1",
  });
});

test("Router autoriza IFTTT apenas para regras criticas e deduplica outbox", async () => {
  const store = new MemoryTaskStateStore();
  const ifttt = new IFTTTProvider({
    enabled: true,
    webhookKey: "test_webhook_key",
    eventName: "neo_agent_alert",
    fetchImpl: async () => ({ ok: true }),
  });
  const telegram = { id: "telegram", isEnabled: () => true, send: async () => ({ status: "sent" }) };
  const resend = { id: "resend", isEnabled: () => true, send: async () => ({ status: "sent" }) };
  const registry = new NotificationProviderRegistry([resend, telegram, ifttt]);
  const router = new NotificationRouter({ store, providerRegistry: registry });
  const result = {
    task_id: "task-1",
    status: "NEEDS_HUMAN",
    approval: { authority_rule: "REVIEW_BLOCK" },
  };

  const first = await router.routeApproval(result);
  const second = await router.routeApproval(result);
  assert.equal(first.length, 2);
  assert.equal(second.length, 0);
  assert.deepEqual(
    [...store.outbox.values()].map((item) => item.channel).sort(),
    ["ifttt", "telegram"]
  );
});

test("Outbox chega a DEAD somente depois de tres falhas de transporte", async () => {
  const store = new MemoryTaskStateStore();
  const id = await store.enqueueNotification({
    kind: "agent_alert",
    channel: "ifttt",
    dedupeKey: "alert-1",
    payload: {},
  });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await store.claimNotification(id);
    const result = await store.failNotification(id, new Error("transport unavailable"));
    assert.equal(result.attempts, attempt);
  }
  assert.equal(store.outbox.get(id).status, "DEAD");
});
