import { createHash, randomUUID } from "node:crypto";

const hash = (text) => createHash("sha256").update(text).digest("hex");
// Preserve only JSON punctuation/whitespace. No values, keys, prose or secrets.
const structure = (text) => text.replace(/[^{}\[\]:,"\\\s]/g, "x");

export class StructuredOutputError extends Error {
  constructor(diagnostic) {
    super(`Structured output rejected: ${diagnostic.failure_kind}`);
    this.name = "StructuredOutputError";
    this.diagnostic = diagnostic;
  }
}

export async function parseStructuredOutput(response, request, recordDiagnostic) {
  const raw = response.text || "";
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]+?)\s*```$/);
  const cleaned = fenced ? fenced[1] : trimmed;
  let parsed;
  let parseError;
  try { parsed = JSON.parse(cleaned); } catch (error) { parseError = error; }
  const finishReason = response.metadata?.finish_reason || null;
  const incomplete = finishReason !== null && finishReason !== "STOP";
  const diagnostic = {
    event: "STRUCTURED_OUTPUT_DIAGNOSTIC",
    diagnostic_id: randomUUID(),
    node_id: request.nodeId,
    provider: request.provider,
    model: request.model || response.metadata?.model || null,
    model_version: response.metadata?.model_version || null,
    finish_reason: finishReason,
    usage: response.metadata?.usage || null,
    max_output_tokens: request.maxTokens || null,
    expected_format: "application/json",
    expected_schema_sha256: hash(JSON.stringify(request.schema || {})),
    expected_root_fields: Object.keys(request.schema?.properties || {}),
    response_sha256: hash(raw),
    response_bytes: Buffer.byteLength(raw),
    normalization: fenced ? "REMOVE_MARKDOWN_FENCE" : "NONE",
    repair_attempts: 0,
    stage: incomplete ? "provider_completion" : "JSON.parse",
    parse_ok: !parseError,
    accepted: !incomplete && !parseError,
    failure_kind: incomplete ? `INCOMPLETE_${finishReason}` : parseError ? "INVALID_JSON" : null,
    recorded_at: new Date().toISOString(),
  };
  if (parseError || incomplete) {
    const position = /position (\d+)/.exec(parseError?.message || "");
    diagnostic.parse_error = parseError ? {
      kind: parseError.message.startsWith("Unterminated") ? "UNTERMINATED_STRING"
        : parseError.message.startsWith("Unexpected end") ? "UNEXPECTED_END" : "SYNTAX_ERROR",
      position: position ? Number(position[1]) : cleaned.length,
    } : null;
    diagnostic.structure_head = structure(raw.slice(0, 256));
    diagnostic.structure_tail = structure(raw.slice(-512));
  }
  // Await persistence before accepting a response or propagating failure.
  if (recordDiagnostic) await recordDiagnostic(diagnostic);
  if (!diagnostic.accepted) throw new StructuredOutputError(diagnostic);
  return parsed;
}
