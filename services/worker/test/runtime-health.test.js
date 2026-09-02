import assert from "node:assert/strict";
import test from "node:test";
import { OrchestratorDiscoveryGateway } from "../../../packages/engine/pilot/adapters.js";
import { RuntimeCoordinator } from "../lib/RuntimeCoordinator.js";

test("Orchestrator health exige resposta HTTP bem-sucedida", async () => {
  const gateway = new OrchestratorDiscoveryGateway({
    baseUrl: "https://orchestrator.example",
    fetchImpl: async () => ({ ok: false }),
  });

  assert.equal(await gateway.checkHealth(), false);
});

test("readiness falha quando Orchestrator configurado esta indisponivel", async () => {
  const runtime = Object.assign(Object.create(RuntimeCoordinator.prototype), {
    store: { isReady: async () => true },
    runQueueConnection: { ping: async () => "PONG" },
    discoveryGateway: { checkHealth: async () => false },
    contextRetriever: { isConfigured: () => true },
    providerRegistry: {
      get: () => ({ isEnabled: () => true }),
    },
    notion: { isConfigured: () => true },
    llmReady: true,
  });

  const health = await runtime.isReady();

  assert.equal(health.ok, false);
  assert.equal(health.context_discovery, "unavailable");
});

test("readiness aceita Orchestrator com health real disponivel", async () => {
  const runtime = Object.assign(Object.create(RuntimeCoordinator.prototype), {
    store: { isReady: async () => true },
    runQueueConnection: { ping: async () => "PONG" },
    discoveryGateway: { checkHealth: async () => true },
    contextRetriever: { isConfigured: () => true },
    providerRegistry: {
      get: () => ({ isEnabled: () => true }),
    },
    notion: { isConfigured: () => true },
    llmReady: true,
  });

  const health = await runtime.isReady();

  assert.equal(health.ok, true);
  assert.equal(health.context_discovery, "ok");
});
