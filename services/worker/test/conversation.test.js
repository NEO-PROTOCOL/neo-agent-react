import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createSign, generateKeyPairSync } from "node:crypto";
import Fastify from "fastify";
import { alexaConfig, alexaResponse, BoundedAlexaSignatureVerifier, isAlexaRoute,
  normalizeAlexa, registerAlexaChannel } from "../lib/AlexaChannel.js";
import { checksum, ConversationGateway, safeText } from "../lib/ConversationGateway.js";
import { PostgresConversationStore } from "../lib/PostgresConversationStore.js";

const config = alexaConfig({ ALEXA_ENABLED: "true", ALEXA_SKILL_ID: "amzn1.ask.skill.fixture",
  ALEXA_ALLOWED_USER_ID: "fixture-user", ALEXA_TASK_IDS: "fixture-task" });
const timestamp = "2026-09-03T12:00:00.000Z";
function envelope({ id = "request-1", kind = "LaunchRequest", text = "", session = "session-1" } = {}) {
  return { version: "1.0", context: { System: { application: { applicationId: config.skillId }, user: { userId: config.userId } } },
    session: { application: { applicationId: config.skillId }, user: { userId: config.userId }, sessionId: session,
      attributes: { task_id: "unauthorized-client-injection" } },
    request: { type: kind, requestId: id, timestamp, locale: "pt-BR", ...(kind === "IntentRequest" ? {
      dialogState: "IN_PROGRESS", intent: { name: "ConversationIntent", slots: { query: { name: "query", value: text } } },
    } : {}) } };
}
const fixtureTask = () => ({ task_id: "fixture-task", status: "APPROVED", updated_at: timestamp,
  intent: { intention: "Preparar checklist mínimo da semana", acceptance_criteria: ["Uma ação verificável"],
    source: { ref: "notion-page-fixture", revision: timestamp, metadata: {
      executable: { title: "Preparar checklist mínimo da semana" }, human_state: { status: "Backlog" },
    } } }, records: [
    { sequence: 1, record_key: "approval", payload: { decision: "APPROVED", review_ref: "review_2" } },
    { sequence: 2, record_key: "execution_1", payload: { action: { output: { markdown: "artefato rejeitado" } } } },
    { sequence: 3, record_key: "execution_2", payload: { action: { output: { markdown: "Revisar backlog" } } } },
    { sequence: 4, record_key: "source_observation", payload: { revision: "revision-2", metadata: { human_state: { status: "Concluído" } } } },
  ] });

// SQL contract double: PostgreSQL semantics/restart in Railway remain a separate real E2E gate.
class FixturePool {
  constructor() { this.sessions = new Map(); this.turns = []; this.sql = []; this.tasks = [fixtureTask()]; this.lock = true; this.expired = false; }
  async connect() { return { query: this.query.bind(this), release() {} }; }
  async query(sql, p = []) {
    this.sql.push(sql);
    const rows = (value = []) => ({ rows: value });
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(sql)) return rows();
    if (sql.includes("pg_try_advisory")) return rows([{ acquired: this.lock }]);
    if (sql.includes("INSERT INTO agent_runtime.conversation_sessions")) {
      if (!this.sessions.has(p[1])) this.sessions.set(p[1], { conversation_id: p[0], context: {}, status: "OPEN" });
      return rows();
    }
    if (sql.includes("FROM agent_runtime.conversation_sessions WHERE")) return rows([{ ...this.sessions.get(p[0]), expired: this.expired }]);
    if (sql.includes("SELECT request_checksum")) return rows(this.turns.filter((t) => t.conversation_id === p[0] && t.request_id === p[1]));
    if (sql.includes("SELECT kind, input_text")) return rows(this.expired ? [] : this.turns.filter((t) => t.conversation_id === p[0]).slice(-10).reverse());
    if (sql.includes("COUNT(*)")) return rows([{ count: this.turns.length }]);
    if (sql.includes("FROM agent_runtime.tasks")) return rows(this.tasks.filter((t) => p[0].includes(t.task_id)));
    if (sql.includes("FROM agent_runtime.task_events")) return rows(this.tasks.find((t) => t.task_id === p[0]).records);
    if (sql.includes("INSERT INTO agent_runtime.conversation_turns")) {
      this.turns.push({ turn_id: p[0], conversation_id: p[1], request_id: p[2], request_checksum: p[3],
        request_timestamp: p[5], kind: p[6], input_text: p[7], response: JSON.parse(p[8]), evidence: JSON.parse(p[9]) });
      return rows();
    }
    if (sql.includes("UPDATE agent_runtime.conversation_sessions") && p.length) {
      const session = [...this.sessions.values()].find((s) => s.conversation_id === p[0]);
      Object.assign(session, { context: JSON.parse(p[1]), status: p[3] }); return rows();
    }
    if (/LIMIT 0|DELETE FROM agent_runtime.conversation_turns|SET context='\{\}'/.test(sql)) return rows();
    throw new Error(`Unexpected fixture SQL: ${sql}`);
  }
}
const input = (options = {}) => {
  const body = envelope(options);
  return normalizeAlexa(body, config, JSON.stringify(body), Date.parse(timestamp));
};
const gatewayFor = (pool, overrides = {}) => new ConversationGateway({
  store: new PostgresConversationStore({ pool }), taskIds: config.taskIds, respond: alexaResponse, ...overrides,
});
const speech = (result) => result.response.response.outputSpeech?.text || "";

test("five-turn E2E: open, known task, follow-up, close, reconstruct gateway and recover PostgreSQL context", async () => {
  const pool = new FixturePool();
  const before = structuredClone(pool.tasks);
  let gateway = gatewayFor(pool);
  assert.match(speech(await gateway.handle(input())), /Qual tarefa/);
  const query = input({ id: "r2", kind: "IntentRequest", text: "Como está Preparar checklist mínimo da semana" });
  assert.match(speech(await gateway.handle(query)), /APPROVED.*Concluído/);
  assert.match(speech(await gateway.handle(input({ id: "r3", kind: "IntentRequest", text: "E os critérios de aceite" }))), /Uma ação verificável/);
  const close = await gateway.handle(input({ id: "r4", kind: "SessionEndedRequest" }));
  assert.deepEqual(close.response.response, {});
  gateway = gatewayFor(pool);
  assert.match(speech(await gateway.handle(input({ id: "r5", session: "session-2" }))), /Retomando.*Preparar checklist/);
  assert.equal(pool.sessions.size, 1);
  assert.equal(pool.turns.length, 5);
  assert.equal(new Set(pool.turns.map((t) => t.turn_id)).size, 5);
  assert.equal(pool.turns[1].evidence.discovery_status, "not_required");
  assert.deepEqual(pool.tasks, before);
  assert.ok(!pool.sql.some((sql) => /(?:INSERT INTO|UPDATE|DELETE FROM) agent_runtime\.(?:tasks|task_events|approvals)/.test(sql)));
  assert.ok(!JSON.stringify(pool.turns).includes("fixture-user"));
});

test("replay is idempotent, conflicting request ID fails and old request cannot rewind context", async () => {
  const pool = new FixturePool(); const gateway = gatewayFor(pool); const launch = input();
  await gateway.handle(launch);
  assert.equal((await gateway.handle(launch)).replayed, true);
  assert.equal(pool.turns.length, 1);
  await assert.rejects(gateway.handle({ ...launch, checksum: "different" }), /REQUEST_ID_CONFLICT/);
  await assert.rejects(gateway.handle({ ...launch, requestId: "old", timestamp: "2026-09-02T00:00:00Z" }), /STALE/);
  assert.equal(pool.turns.length, 1);
  assert.equal(pool.sql.at(-1), "ROLLBACK");
});

test("task allowlist, ambiguity, unknown explicit task and mutations fail closed", async () => {
  const pool = new FixturePool(); const gateway = gatewayFor(pool);
  await gateway.handle(input({ kind: "IntentRequest", text: "Preparar checklist mínimo da semana" }));
  for (const [id, text, expected] of [["r2", "a tarefa projeto desconhecido", /Não identifiquei/],
    ["r3", "marque essa tarefa como concluída", /apenas consultas/]]) {
    assert.match(speech(await gateway.handle(input({ id, kind: "IntentRequest", text }))), expected);
  }
  assert.equal(pool.turns[2].evidence.decision, "BLOCKED_READ_ONLY");
  assert.match(speech(await gatewayFor(pool, { taskIds: [] }).handle(input({ id: "r4" }))), /Qual tarefa/);
  pool.tasks.push({ ...fixtureTask(), task_id: "other" });
  assert.match(speech(await gatewayFor(pool, { taskIds: ["fixture-task", "other"] })
    .handle(input({ id: "r5", kind: "IntentRequest", text: "Preparar checklist mínimo da semana" }))), /mais de uma/);
});

test("approved result selects exact reviewed attempt; human status uses latest observation", async () => {
  const pool = new FixturePool(); const gateway = gatewayFor(pool);
  const result = await gateway.handle(input({ kind: "IntentRequest", text: "resultado de Preparar checklist mínimo da semana" }));
  assert.match(speech(result), /Revisar backlog/); assert.doesNotMatch(speech(result), /rejeitado/);
  assert.equal(pool.turns[0].evidence.source_revision, "revision-2");
  assert.deepEqual(pool.turns[0].evidence.event_sequences, ["1", "2", "3", "4"]);
});

test("optional conversation provider uses registry/schema, logs bounded diagnostics, no silent fallback", async () => {
  for (const answer of ['{"facet":"CRITERIA"}', '{"facet":"CRITERIA","token":"private"}', '{"token":"private",BROKEN}']) {
    const pool = new FixturePool(); let calls = 0;
    const registry = { resolve(id) { assert.equal(id, "fixture"); return { id, isConfigured: () => true,
      async execute(args) { calls++; assert.deepEqual(args.toolDeclarations, []);
        assert.equal(args.model, "fixture-model"); assert.equal(args.generationConfig.responseMimeType, "application/json");
        return { text: answer, metadata: { finish_reason: "STOP" } }; } }; } };
    const gateway = gatewayFor(pool, { providerRegistry: registry, provider: "fixture", model: "fixture-model" });
    await gateway.handle(input({ kind: "IntentRequest", text: "Preparar checklist mínimo da semana" }));
    const result = await gateway.handle(input({ id: "r2", kind: "IntentRequest", text: "E o que precisa satisfazer" }));
    assert.equal(calls, 1);
    const evidence = pool.turns[1].evidence;
    assert.equal(evidence.provider, "fixture"); assert.equal(evidence.model, "fixture-model");
    assert.equal(evidence.fallback, null); assert.ok(Number.isFinite(evidence.latency_ms));
    assert.ok(!JSON.stringify(evidence).includes("private"));
    assert.match(speech(result), answer === '{"facet":"CRITERIA"}' ? /Uma ação verificável/ : /Não consegui interpretar/);
  }
});

test("slow provider times out, no task mutation; expired context is not restored", async () => {
  const pool = new FixturePool();
  const gateway = gatewayFor(pool, { timeoutMs: 10, model: "fixture", providerRegistry: { resolve: () => ({
    id: "fixture", isConfigured: () => true, execute: () => new Promise(() => {}),
  }) } });
  await gateway.handle(input({ kind: "IntentRequest", text: "Preparar checklist mínimo da semana" }));
  assert.match(speech(await gateway.handle(input({ id: "r2", kind: "IntentRequest", text: "O que precisa satisfazer" }))), /Não consegui/);
  pool.expired = true;
  assert.match(speech(await gateway.handle(input({ id: "r3" }))), /Qual tarefa/);
});

test("lock contention, rate limit, connection timeout and retention are bounded and separate from ledger", async () => {
  const pool = new FixturePool(); const store = new PostgresConversationStore({ pool });
  pool.lock = false; await assert.rejects(store.turn(input(), () => {}), /BUSY/);
  pool.lock = true; pool.turns = Array.from({ length: 12 }, () => ({}));
  await assert.rejects(store.turn(input(), () => {}), /RATE_LIMIT/);
  await store.purgeExpired();
  assert.ok(!pool.sql.some((sql) => /DELETE FROM agent_runtime\.task_events/.test(sql)));
  assert.throws(() => new PostgresConversationStore({ pool, retentionDays: 0 }), /retention/);
  assert.equal(await store.isReady(), true);
});

test("auth normalization rejects wrong app/user/locale, missing, old, future and invalid timestamps", () => {
  const mutations = [
    (e) => { e.context.System.application.applicationId = "wrong"; },
    (e) => { e.session.application.applicationId = "wrong"; },
    (e) => { e.context.System.user.userId = "wrong"; },
    (e) => { e.session.user.userId = "wrong"; },
    (e) => { e.request.locale = "en-US"; },
    (e) => { e.request.timestamp = "invalid"; },
    (e) => { e.request.timestamp = "2026-09-03T13:00:00Z"; },
    (e) => { e.request.timestamp = "2026-09-03T11:00:00Z"; },
    (e) => { delete e.session; },
  ];
  for (const mutate of mutations) { const e = envelope(); mutate(e); assert.throws(() => normalizeAlexa(e, config, JSON.stringify(e), Date.parse(timestamp))); }
  assert.equal(alexaConfig({}).enabled, false); assert.equal(alexaConfig({ ALEXA_ENABLED: "true" }).configured, false);
});

test("raw signature verification detects payload tampering and rejects non-Amazon certificate URLs", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const verifier = new BoundedAlexaSignatureVerifier({ fetchImpl: async () => { throw new Error("NETWORK_MUST_NOT_BE_USED"); } });
  const raw = JSON.stringify(envelope());
  const signature = createSign("RSA-SHA256").update(raw).sign(privateKey, "base64");
  const key = publicKey.export({ format: "pem", type: "spki" });
  verifier._validateRequestBody(key, signature, raw);
  assert.throws(() => verifier._validateRequestBody(key, signature, raw + " "));
  for (const url of ["http://s3.amazonaws.com/echo.api/x.pem", "https://localhost/x.pem", "https://s3.amazonaws.com/wrong/x.pem", "https://s3.amazonaws.com:444/echo.api/x.pem"]) {
    await assert.rejects(verifier.verify(raw, { "signature-256": signature, signaturecertchainurl: url }), (e) => !e.message.includes("NETWORK_MUST_NOT_BE_USED"));
  }
  assert.throws(() => verifier._validateCertChain("not a certificate"));
});

test("certificate fetch timeout/redirect/size policy and cache expiry revalidation", async () => {
  const verifier = new BoundedAlexaSignatureVerifier({ fetchImpl: async (_url, opts) => {
    assert.equal(opts.redirect, "error"); assert.ok(opts.signal);
    return new Response("x".repeat(32769));
  } });
  await assert.rejects(verifier._getCertChainByUrl("fixture"), /CERTIFICATE_TOO_LARGE/);
  verifier.certCache.set("expired", "invalid certificate");
  await assert.rejects(verifier.verify("{}", {}));
  assert.equal(verifier.certCache.size, 0);
});

test("Fastify raw body isolation, Alexa-only auth, disabled route and signed transport", async () => {
  const app = Fastify(); const pool = new FixturePool(); let verified = 0;
  app.addHook("onRequest", async (req, reply) => { if (!isAlexaRoute(req) && req.headers.authorization !== "Bearer fixture") return reply.code(401).send({ error: "unauthorized" }); });
  app.post("/normal", async (req) => ({ parsed: typeof req.body === "object" && !Buffer.isBuffer(req.body) }));
  const channel = await registerAlexaChannel(app, { config, gateway: gatewayFor(pool), store: new PostgresConversationStore({ pool }),
    signatureVerifier: { async verify(raw) { assert.equal(raw, JSON.stringify(envelope())); verified++; } },
    timestampVerifier: { async verify() {} }, now: () => Date.parse(timestamp) });
  try {
    const request = { method: "POST", url: "/channels/alexa", payload: envelope(), headers: { "signature-256": "fixture", signaturecertchainurl: "fixture" } };
    assert.equal((await app.inject(request)).statusCode, 200);
    assert.equal(verified, 1);
    assert.equal((await app.inject({ ...request, headers: {} })).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: "/normal", payload: {} })).statusCode, 401);
    assert.deepEqual((await app.inject({ method: "POST", url: "/normal", payload: {}, headers: { authorization: "Bearer fixture" } })).json(), { parsed: true });
    assert.equal((await app.inject({ ...request, payload: "x".repeat(33000), headers: { ...request.headers, "content-type": "application/json" } })).statusCode, 413);
    assert.equal(await channel.health(), "ok");
  } finally { await app.close(); }
  const disabled = Fastify();
  const health = await registerAlexaChannel(disabled, { config: alexaConfig({}) });
  assert.equal((await disabled.inject({ method: "POST", url: "/channels/alexa", payload: {} })).statusCode, 503);
  assert.equal(await health.health(), "disabled"); await disabled.close();
});

test("interaction model: pt-BR invocation, one search slot, no Lambda/business logic; safe plain text responses", async () => {
  const model = JSON.parse(await readFile(new URL("../../../channels/alexa/interaction-model.pt-BR.json", import.meta.url), "utf8"));
  assert.equal(model.interactionModel.languageModel.invocationName, "neo agent");
  assert.equal(model.interactionModel.dialog.delegationStrategy, "SKILL_RESPONSE");
  const response = alexaResponse("token=secret https://private.example/value");
  assert.equal(response.response.outputSpeech.type, "PlainText");
  assert.ok(!JSON.stringify(response).includes("secret"));
  assert.equal(response.response.directives[0].updatedIntent.slots.query.value, undefined);
  assert.equal(alexaResponse("tchau", { closed: true }).response.shouldEndSession, true);
  assert.equal(safeText("Bearer abc"), "[credencial omitida]");
  const sql = await readFile(new URL("../migrations/002_conversation.sql", import.meta.url), "utf8");
  assert.match(sql, /UNIQUE \(conversation_id, request_id\)/);
  assert.doesNotMatch(sql, /(?:UPDATE|DELETE FROM|ALTER TABLE) agent_runtime\.(?:tasks|task_events|approvals)/);
});
