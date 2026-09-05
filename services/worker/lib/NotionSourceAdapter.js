import { createHash } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const text = (property) => (property?.[property.type] || [])
  .map((fragment) => fragment.plain_text || fragment.text?.content || "").join("").trim();
const select = (property) => property?.[property.type]?.name || null;

export function parseDescription(description) {
  const sections = { context: [], criteria: [], constraints: [] };
  let section = "context";
  for (const line of description.split(/\r?\n/)) {
    const heading = line.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const match = /^(contexto|criterios de aceite|restricoes):\s*(.*)$/.exec(heading);
    if (match) {
      section = { contexto: "context", "criterios de aceite": "criteria", restricoes: "constraints" }[match[1]];
      const inline = line.slice(line.indexOf(":") + 1).trim();
      if (inline) sections[section].push(inline);
    } else {
      const value = line.replace(/^\s*[-*]\s+/, "").trim();
      if (value) sections[section].push(value);
    }
  }
  return sections;
}

function repositoryKey(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.replace(/\.git\/?$/, "").split("/").filter(Boolean);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || parts.length !== 2 || url.search || url.hash) return null;
    return parts.join("/").toLowerCase();
  } catch { return null; }
}

export class NotionSourceAdapter {
  constructor({ apiKey = process.env.NOTION_API_KEY,
    dataSourceId = process.env.NOTION_DATA_SOURCE_ID,
    apiVersion = process.env.NOTION_API_VERSION || "2026-03-11",
    orchestratorUrl = process.env.NEO_ORCHESTRATOR_URL,
    fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
    Object.assign(this, { apiKey, dataSourceId, apiVersion, orchestratorUrl, fetchImpl, timeoutMs });
  }

  isConfigured() { return Boolean(this.apiKey && this.dataSourceId && this.fetchImpl); }

  async validateCredentials() {
    if (!this.apiKey || !this.fetchImpl) return { ok: false, reason: "not_configured" };
    const response = await this.#request("/v1/users/me", { method: "GET" });
    return { ok: response.ok, status: response.status };
  }

  async checkHealth() {
    if (!this.isConfigured()) return false;
    try {
      const response = await this.#request("/v1/data_sources/" + encodeURIComponent(this.dataSourceId), { method: "GET" });
      if (!response.ok) return false;
      const source = await response.json();
      return !source.in_trash && source.properties?.["Incluir no Agent"]?.type === "checkbox"
        && source.properties?.Tarefa?.type === "title" && source.properties?.Descrição?.type === "rich_text";
    } catch { return false; }
  }

  async listWeekIntents({ editedAfter, pageId } = {}) {
    if (!this.isConfigured()) return { status: "disabled", intents: [] };
    const pages = [];
    if (pageId) {
      const response = await this.#request("/v1/pages/" + encodeURIComponent(pageId), { method: "GET" });
      if (!response.ok) throw new Error("Notion page HTTP " + response.status);
      const page = await response.json();
      if (page.parent?.data_source_id !== this.dataSourceId) throw new Error("Notion page outside configured data source");
      pages.push(page);
    } else {
      let cursor;
      const MAX_PAGES = 50; // 50 × 100 = 5 000 tasks max per poll — prevents unbounded loops
      let page = 0;
      do {
        if (page >= MAX_PAGES) {
          throw new Error(`Notion pagination exceeded ${MAX_PAGES} pages — datasource may be too large`);
        }
        const filters = [{ property: "Incluir no Agent", checkbox: { equals: true } }];
        if (editedAfter) filters.push({ timestamp: "last_edited_time", last_edited_time: { after: new Date(editedAfter).toISOString() } });
        const response = await this.#request("/v1/data_sources/" + encodeURIComponent(this.dataSourceId) + "/query", {
          method: "POST", body: { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}),
            filter: filters.length === 1 ? filters[0] : { and: filters } },
        });
        if (!response.ok) throw new Error("Notion query HTTP " + response.status);
        const result = await response.json();
        pages.push(...result.results);
        cursor = result.has_more ? result.next_cursor : undefined;
        page += 1;
      } while (cursor);
    }
    const selected = pages.filter((p) => !p.in_trash && !p.archived && p.properties?.["Incluir no Agent"]?.checkbox === true);
    if (!selected.length) return { status: "ok", intents: [] };
    const registry = await this.#registry();
    const projects = new Map();
    const intents = [];
    for (const page of selected) {
      const references = page.properties.Projeto?.relation || [];
      for (const { id } of references) {
        if (projects.has(id)) continue;
        try {
          const response = await this.#request("/v1/pages/" + encodeURIComponent(id), { method: "GET" });
          if (!response.ok) throw new Error("project_unavailable");
          const project = await response.json();
          projects.set(id, { id, name: text(project.properties?.Nome),
            repository: project.properties?.GitHub?.url || null,
            unavailable: Boolean(project.in_trash || project.archived) });
        } catch { projects.set(id, { id, unavailable: true }); }
      }
      intents.push(this.normalizePage(page, { registry, projects: references.map(({ id }) => projects.get(id)) }));
    }
    return { status: "ok", intents };
  }

  normalizePage(page, { registry = { nodes: [], checksum: null }, projects = [] } = {}) {
    const properties = page.properties || {};
    if (page.in_trash || page.archived || properties["Incluir no Agent"]?.checkbox !== true) return null;
    if (!page.id || !page.last_edited_time) throw new Error("Notion source identity missing");
    const title = text(properties.Tarefa);
    const description = text(properties.Descrição);
    const parsed = parseDescription(description);
    const organization = select(properties.Organização);
    const projectIds = (properties.Projeto?.relation || []).map((p) => p.id).sort();
    const candidates = projects.length === 1 && projectIds.length === 1 && projects[0].id === projectIds[0] && !projects[0].unavailable
      ? registry.nodes.filter((n) => {
        const key = repositoryKey(n.repository);
        return key && /^[a-zA-Z0-9_-]{1,128}$/.test(n.id)
          && key === repositoryKey(projects[0].repository) && key.split("/")[0] === organization?.toLowerCase();
      }) : [];
    const node = candidates.length === 1 ? candidates[0] : null;
    const routingStatus = node ? "RESOLVED" : "UNRESOLVED";
    const reasons = [];
    if (!title) reasons.push("TITLE_MISSING");
    if (!parsed.criteria.length) reasons.push("ACCEPTANCE_CRITERIA_MISSING");
    if (!node) reasons.push("ROUTING_UNRESOLVED");
    if (properties.Projeto?.has_more) reasons.push("PROJECT_RELATION_TRUNCATED");
    const executable = { title, description, domain: select(properties.Domínio), organization,
      project_ids: projectIds, repositories: projects.map((p) => p.repository || null).sort(),
      priority: select(properties.Prioridade),
      planned_date: properties["Data Planejada"]?.date || null, due_date: properties["Data Limite"]?.date || null };
    const constraints = [...parsed.constraints, "Contexto operacional: " + JSON.stringify({
      domain: executable.domain, organization, project_ids: projectIds,
      priority: executable.priority, planned_date: executable.planned_date, due_date: executable.due_date,
    })];
    return {
      task_id: "notion-" + page.id.replaceAll("-", "") + "-" + hash(page.last_edited_time + JSON.stringify(executable)).slice(0, 24),
      current_node: node?.id || null, routing_status: routingStatus,
      intake_status: reasons.length ? "NEEDS_HUMAN" : "READY", intake_reasons: reasons,
      intention: [title || "[Tarefa sem título]", parsed.context.join("\n")].filter(Boolean).join("\n\n"),
      acceptance_criteria: parsed.criteria, constraints,
      source: { type: "notion", ref: "notion:" + page.id, revision: page.last_edited_time,
        metadata: { page_id: page.id, last_edited_time: page.last_edited_time,
          data_source_id: this.dataSourceId, url: page.url || null, executable, projects,
          human_state: { status: select(properties.Status),
            responsible: (properties.Responsável?.people || []).map((p) => ({ id: p.id, name: p.name || null })),
            include_in_agent: true },
          routing: { status: routingStatus, registry_checksum: registry.checksum,
            reason: node ? "EXACT_ORGANIZATION_AND_PROJECT_REPOSITORY" : registry.reason || "NO_UNIQUE_EXACT_MATCH",
            evidence: node ? { node_id: node.id, repository: node.repository, project_page_id: projects[0].id } : null },
        } },
    };
  }

  async #registry() {
    try {
      if (!this.orchestratorUrl) throw new Error("unconfigured");
      const response = await this.fetchImpl(this.orchestratorUrl.replace(/\/$/, "") + "/config/ecosystem.json",
        { headers: { accept: "application/json" }, signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) throw new Error("unavailable");
      const raw = await response.text();
      const nodes = JSON.parse(raw);
      if (!Array.isArray(nodes)) throw new Error("invalid");
      return { nodes, checksum: hash(raw) };
    } catch { return { nodes: [], checksum: null, reason: "REGISTRY_UNAVAILABLE" }; }
  }

  async #request(path, { method, body } = {}) {
    return this.fetchImpl("https://api.notion.com" + path, {
      method, headers: { authorization: "Bearer " + this.apiKey, "notion-version": this.apiVersion, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(this.timeoutMs),
    });
  }
}
