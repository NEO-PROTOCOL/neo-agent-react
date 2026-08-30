import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const RUNTIME_DOCUMENTS = [
  "gates/architecture-gate.md",
  "gates/destructive-gate.md",
  "gates/logic-gate.md",
  "policies/execution-doctrine.md",
  "policies/scope-control.md",
];

export async function loadRuntimeDocuments(runtimeRoot) {
  if (!runtimeRoot) throw new Error("NEO_AGENT_RUNTIME_ROOT ausente");

  const documents = [];
  const version = createHash("sha256");
  for (const relativePath of RUNTIME_DOCUMENTS) {
    const content = await readFile(resolve(runtimeRoot, relativePath), "utf8");
    if (!content.trim()) throw new Error(`Doutrina vazia: ${relativePath}`);
    version.update(relativePath).update("\0").update(content).update("\0");
    documents.push({ name: relativePath, content });
  }

  return { documents, version: version.digest("hex") };
}

export class NeoContextGateway {
  constructor({
    baseUrl = process.env.NEO_CONTEXT_URL,
    token = process.env.NEO_CONTEXT_TOKEN,
    timeoutMs = 3_000,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.baseUrl = baseUrl?.replace(/\/$/, "");
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async recall({ query, topic }) {
    if (!this.baseUrl) return { status: "unavailable", hits: [] };
    try {
      const body = await this.#request("/recall", {
        query,
        topic,
        kinds: ["decision", "failure", "principle", "context"],
        limit: 8,
      });
      return { status: "ok", hits: Array.isArray(body.hits) ? body.hits : [] };
    } catch (error) {
      return { status: "unavailable", hits: [], error: this.#safeError(error) };
    }
  }

  async persist({ kind, topic, content, sessionId }) {
    if (!this.baseUrl) return { status: "unavailable" };
    try {
      const body = await this.#request("/persist", {
        kind,
        topic,
        content,
        tags: ["pilot", "weekly-loop"],
        agent: "neo-agent-react",
        sessionId,
      });
      return { status: body.persisted ? "ok" : "unavailable", id: body.id };
    } catch (error) {
      return { status: "unavailable", error: this.#safeError(error) };
    }
  }

  async #request(path, payload) {
    if (typeof this.fetchImpl !== "function") throw new Error("fetch indisponivel");
    const headers = { "content-type": "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`neo-context HTTP ${response.status}`);
    return response.json();
  }

  #safeError(error) {
    return error instanceof Error ? error.message : "neo-context indisponivel";
  }
}
