import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { parseStructuredOutput, StructuredOutputError } from "../../../packages/engine/StructuredOutput.js";
import { AgentRunner } from "../../../packages/engine/AgentRunner.js";
import { createPilotRoles } from "../../../packages/engine/pilot/roles.js";
import { parseAgentConfig } from "../../../packages/engine/schemas/agentSchema.js";
import { GeminiProviderAdapter } from "../../../packages/engine/providers/GeminiProviderAdapter.js";

const request = { nodeId: "execution_1", provider: "gemini", model: "fixture-model",
  maxTokens: 8192, schema: { type: "object", properties: { value: { type: "string" } } } };
test("native structured JSON succeeds and records provider/model/checksum before returning", async () => {
  const records = [];
  const raw = '{"value":"ok"}';
  const output = await parseStructuredOutput({ text: raw, metadata: { finish_reason: "STOP" } }, request, async (d) => records.push(d));
  assert.deepEqual(output, { value: "ok" });
  assert.equal(records.length, 1);
  assert.equal(records[0].provider, "gemini");
  assert.equal(records[0].model, "fixture-model");
  assert.equal(records[0].response_sha256, createHash("sha256").update(raw).digest("hex"));
  assert.equal(records[0].accepted, true);
  assert.equal(records[0].repair_attempts, 0);
});
test("MAX_TOKENS with unterminated JSON is rejected, diagnosed and never repaired", async () => {
  const records = [];
  await assert.rejects(parseStructuredOutput({ text: '{"value":"unfinished', metadata: {
    finish_reason: "MAX_TOKENS", usage: { thinking_tokens: 1915, output_tokens: 118 },
  } }, request, async (d) => records.push(d)), StructuredOutputError);
  assert.equal(records.length, 1);
  assert.equal(records[0].parse_ok, false);
  assert.equal(records[0].failure_kind, "INCOMPLETE_MAX_TOKENS");
  assert.equal(records[0].parse_error.kind, "UNTERMINATED_STRING");
  assert.equal(records[0].parse_error.position, 20);
  assert.equal(records[0].repair_attempts, 0);
});
test("even parseable JSON with MAX_TOKENS or SAFETY cannot pass", async () => {
  for (const finish_reason of ["MAX_TOKENS", "SAFETY"]) {
    await assert.rejects(parseStructuredOutput({ text: "{}", metadata: { finish_reason } }, request), StructuredOutputError);
  }
});
test("diagnostics never contain provider text, credentials, PII or parse-error excerpts", async () => {
  const raw = '{"email":"person@example.com","token":"super-secret-123","medical":"private diagnosis",BAD}';
  let diagnostic;
  await assert.rejects(parseStructuredOutput({ text: raw }, request, async (d) => { diagnostic = d; }), (e) => {
    assert.equal(e.message, "Structured output rejected: INVALID_JSON"); return true;
  });
  const json = JSON.stringify(diagnostic);
  for (const secret of ["person", "example.com", "super-secret", "private", "diagnosis", "BAD", "email", "medical"]) assert.ok(!json.includes(secret));
  assert.match(diagnostic.structure_tail, /[{}\[\]:,"]/);
});
test("existing Markdown-fence normalization is lossless and now explicit", async () => {
  let diagnostic;
  assert.deepEqual(await parseStructuredOutput({ text: '```json\n{"value":"a,b"}\n```' }, request,
    async (d) => { diagnostic = d; }), { value: "a,b" });
  assert.equal(diagnostic.normalization, "REMOVE_MARKDOWN_FENCE");
});
test("diagnostic persistence failure prevents accepting the result", async () => {
  await assert.rejects(parseStructuredOutput({ text: "{}" }, request, async () => { throw new Error("store unavailable"); }), /store unavailable/);
});
test("only roles with proven truncation get larger budgets; native schema uses one provider call", async () => {
  const roles = createPilotRoles({ providerId: "fixture", model: "fixture-model" });
  const executor = parseAgentConfig(roles.executor(1));
  assert.equal(executor.config.maxTokens, 8192);
  assert.equal(roles.operator.config.maxTokens, 8192);
  assert.equal(roles.planner.config.maxTokens, 2048);
  assert.equal(roles.reviewer(1).config.maxTokens, 2048);
  let called = 0;
  const runner = new AgentRunner({ providerRegistry: { resolve: () => ({ id: "fixture", isConfigured: () => true,
    execute: async (r) => {
      called++;
      assert.equal(r.generationConfig.responseMimeType, "application/json");
      assert.deepEqual(r.generationConfig.responseSchema, executor.systemConfig.outputSchema);
      assert.equal(r.generationConfig.maxOutputTokens, 8192);
      assert.deepEqual(r.toolDeclarations, []);
      return { text: "{}", metadata: { finish_reason: "STOP" } };
    } }) } });
  await runner.execute(executor, {});
  assert.equal(called, 1);
});
test("Gemini adapter propagates finish reason and token counts without provider raw metadata", async () => {
  const provider = new GeminiProviderAdapter({ apiKey: "" });
  provider.client = { getGenerativeModel: () => ({ generateContent: async () => ({ response: {
    text: () => "{}", candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }],
    modelVersion: "fixture-model", usageMetadata: { thoughtsTokenCount: 1915, candidatesTokenCount: 118, secret: "do-not-copy" },
  } }) }) };
  // The existing SDK timeout timer is mocked to avoid a 60s test-process delay.
  const original = globalThis.setTimeout;
  globalThis.setTimeout = (...args) => original(...args).unref();
  try {
    const result = await provider.execute({ model: "fixture-model", generationConfig: {} });
    assert.equal(result.metadata.finish_reason, "MAX_TOKENS");
    assert.equal(result.metadata.usage.thinking_tokens, 1915);
    assert.ok(!JSON.stringify(result).includes("do-not-copy"));
  } finally { globalThis.setTimeout = original; }
});
