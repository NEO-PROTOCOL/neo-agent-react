import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_DISCOVERY_BUDGET = Object.freeze({
  max_sources: 4,
  max_hops: 1,
  max_characters: 12_000,
});

export class DiscoveryUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "DiscoveryUnavailableError";
  }
}

export class ContextBudgetError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContextBudgetError";
    this.code = "CONTEXT_BUDGET_EXCEEDED";
  }
}

function safeRepositoryFileUrl(source) {
  const repository = new URL(source.repository);
  if (repository.protocol !== "https:" || repository.hostname !== "github.com") {
    throw new Error("Context source repository must use https://github.com");
  }
  const parts = repository.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
  if (parts.length !== 2) throw new Error("Context source repository is invalid");
  if (!source.ref || source.ref.includes("..") || source.ref.includes("/")) {
    throw new Error("Context source ref is invalid");
  }
  const pathParts = source.path.split("/").filter(Boolean);
  const forbiddenSegment = pathParts.some((segment) =>
    /^(?:\.git|\.env(?:\.|$)|secrets?|credentials?)$/i.test(segment)
  );
  if (
    !pathParts.length ||
    pathParts.includes("..") ||
    forbiddenSegment ||
    !/\.(?:json|md)$/i.test(pathParts.at(-1))
  ) {
    throw new Error("Context source path is not allowed");
  }
  const repositoryPath = parts.map(encodeURIComponent).join("/");
  const contentPath = pathParts.map(encodeURIComponent).join("/");
  return `https://api.github.com/repos/${repositoryPath}/contents/${contentPath}?ref=${encodeURIComponent(source.ref)}`;
}

export class OrchestratorDiscoveryGateway {
  constructor({
    baseUrl = process.env.NEO_ORCHESTRATOR_URL,
    timeoutMs = 3_000,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.baseUrl = baseUrl?.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.baseUrl && typeof this.fetchImpl === "function");
  }

  async checkHealth() {
    if (!this.isConfigured()) return false;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/health`, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async discover({ query, currentNode, maxNodes = 3, budget = DEFAULT_DISCOVERY_BUDGET }) {
    if (!this.baseUrl) throw new DiscoveryUnavailableError("orchestrator_not_configured");
    if (typeof this.fetchImpl !== "function") {
      throw new DiscoveryUnavailableError("fetch_unavailable");
    }
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/discovery/context`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query,
          current_node: currentNode,
          max_nodes: maxNodes,
          budget,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new DiscoveryUnavailableError("orchestrator_unavailable");
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (body.error === "CONTEXT_BUDGET_EXCEEDED") {
        throw new ContextBudgetError("Orchestrator rejected context budget");
      }
      if (response.status >= 500) {
        throw new DiscoveryUnavailableError("registry_unavailable");
      }
      throw new Error(`Context discovery HTTP ${response.status}: ${body.error || "invalid_request"}`);
    }
    return response.json();
  }
}

export class SelectiveContextRetriever {
  constructor({
    token = process.env.CONTEXT_SOURCE_GITHUB_TOKEN,
    timeoutMs = 5_000,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.token && typeof this.fetchImpl === "function");
  }

  async retrieve({ sources, budget = DEFAULT_DISCOVERY_BUDGET }) {
    if (sources.length > budget.max_sources) {
      throw new ContextBudgetError("Selected sources exceed max_sources");
    }
    if (typeof this.fetchImpl !== "function") {
      throw new DiscoveryUnavailableError("fetch_unavailable");
    }
    const entries = [];
    let usedCharacters = 0;
    for (const source of sources) {
      let response;
      try {
        const headers = {
          accept: "application/vnd.github.raw+json",
          "user-agent": "neo-agent-react-context-retriever",
        };
        if (this.token) headers.authorization = `Bearer ${this.token}`;
        response = await this.fetchImpl(safeRepositoryFileUrl(source), {
          headers,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch {
        throw new DiscoveryUnavailableError(`source_unavailable:${source.source_id}`);
      }
      if (!response.ok) {
        throw new DiscoveryUnavailableError(`source_unavailable:${source.source_id}`);
      }
      const content = await response.text();
      if (!content.trim()) {
        throw new DiscoveryUnavailableError(`source_empty:${source.source_id}`);
      }
      usedCharacters += content.length;
      if (usedCharacters > budget.max_characters) {
        throw new ContextBudgetError("Retrieved context exceeds max_characters");
      }
      entries.push({
        source_id: source.source_id,
        node_id: source.node_id,
        relation_kind: source.relation_kind,
        authority: source.authority,
        repository: source.repository,
        ref: source.ref,
        path: source.path,
        checksum_sha256: createHash("sha256").update(content).digest("hex"),
        characters: content.length,
        content,
      });
    }
    return { entries, usedCharacters };
  }
}

const RUNTIME_DOCUMENTS = [
  "gates/architecture-gate.md",
  "gates/destructive-gate.md",
  "gates/logic-gate.md",
  "policies/execution-doctrine.md",
  "policies/scope-control.md",
];

export async function loadRuntimeDocuments(runtimeRoot) {
  if (!runtimeRoot) {
    const raw = await readFile(new URL("./doctrine.bundle.json", import.meta.url), "utf8");
    const bundle = JSON.parse(raw);
    if (
      bundle.schema_version !== "doctrine.bundle.v1" ||
      !Array.isArray(bundle.documents) ||
      !bundle.version
    ) {
      throw new Error("Bundle de doutrina invalido");
    }
    return { documents: bundle.documents, version: bundle.version };
  }

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
