import { createHash } from "node:crypto";

const TASK_ID_LIMIT = 128;

function textFromFragments(fragments = []) {
  return fragments.map((fragment) => fragment.plain_text || "").join("").trim();
}

function propertyValues(property) {
  if (!property) return [];
  if (property.type === "title") return [textFromFragments(property.title)];
  if (property.type === "rich_text") {
    return textFromFragments(property.rich_text)
      .split(/\r?\n/)
      .map((value) => value.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
  }
  if (property.type === "multi_select") {
    return property.multi_select.map((item) => item.name.trim()).filter(Boolean);
  }
  if (property.type === "select" && property.select?.name) return [property.select.name.trim()];
  if (property.type === "status" && property.status?.name) return [property.status.name.trim()];
  return [];
}

function safeTaskId(pageId, revision) {
  const normalizedPage = pageId.replace(/[^a-zA-Z0-9_-]/g, "");
  const revisionHash = createHash("sha256").update(revision).digest("hex").slice(0, 12);
  return `notion-${normalizedPage}-${revisionHash}`.slice(0, TASK_ID_LIMIT);
}

export class NotionSourceAdapter {
  constructor({
    apiKey = process.env.NOTION_API_KEY,
    dataSourceId = process.env.NOTION_DATA_SOURCE_ID,
    apiVersion = process.env.NOTION_API_VERSION || "2026-03-11",
    intentionProperty = process.env.NOTION_INTENTION_PROPERTY,
    acceptanceCriteriaProperty =
      process.env.NOTION_ACCEPTANCE_CRITERIA_PROPERTY || "Acceptance Criteria",
    constraintsProperty = process.env.NOTION_CONSTRAINTS_PROPERTY || "Constraints",
    statusProperty = process.env.NOTION_STATUS_PROPERTY,
    readyValue = process.env.NOTION_READY_VALUE || "Ready",
    fetchImpl = globalThis.fetch,
    timeoutMs = 10_000,
  } = {}) {
    this.apiKey = apiKey;
    this.dataSourceId = dataSourceId;
    this.apiVersion = apiVersion;
    this.intentionProperty = intentionProperty;
    this.acceptanceCriteriaProperty = acceptanceCriteriaProperty;
    this.constraintsProperty = constraintsProperty;
    this.statusProperty = statusProperty;
    this.readyValue = readyValue;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.dataSourceId && this.fetchImpl);
  }

  async validateCredentials() {
    if (!this.apiKey || !this.fetchImpl) return { ok: false, reason: "not_configured" };
    const response = await this.#request("/v1/users/me", { method: "GET" });
    return { ok: response.ok, status: response.status };
  }

  async listWeekIntents({ editedAfter } = {}) {
    if (!this.isConfigured()) return { status: "disabled", intents: [] };

    const intents = [];
    let cursor;
    do {
      const body = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const filters = [];
      if (editedAfter) {
        filters.push({
          timestamp: "last_edited_time",
          last_edited_time: { after: new Date(editedAfter).toISOString() },
        });
      }
      if (this.statusProperty) {
        filters.push({
          property: this.statusProperty,
          status: { equals: this.readyValue },
        });
      }
      if (filters.length === 1) body.filter = filters[0];
      if (filters.length > 1) body.filter = { and: filters };

      const response = await this.#request(
        `/v1/data_sources/${encodeURIComponent(this.dataSourceId)}/query`,
        { method: "POST", body }
      );
      if (!response.ok) throw new Error(`Notion query failed with HTTP ${response.status}`);
      const page = await response.json();
      for (const result of page.results || []) intents.push(this.normalizePage(result));
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);

    return { status: "ok", intents };
  }

  normalizePage(page) {
    const properties = page?.properties || {};
    const intentionProperty = this.intentionProperty
      ? properties[this.intentionProperty]
      : Object.values(properties).find((property) => property?.type === "title");
    const intention = propertyValues(intentionProperty)[0];
    const acceptanceCriteria = propertyValues(properties[this.acceptanceCriteriaProperty]);
    const constraints = propertyValues(properties[this.constraintsProperty]);

    if (!page?.id || !page?.last_edited_time || !intention || !acceptanceCriteria.length) {
      throw new Error("Notion page does not satisfy WeekIntent mapping");
    }

    return {
      task_id: safeTaskId(page.id, page.last_edited_time),
      intention,
      acceptance_criteria: acceptanceCriteria,
      constraints,
      source: {
        type: "notion",
        ref: `notion:${page.id}`,
        revision: page.last_edited_time,
      },
    };
  }

  async #request(path, { method, body } = {}) {
    const headers = {
      authorization: `Bearer ${this.apiKey}`,
      "notion-version": this.apiVersion,
      "content-type": "application/json",
    };
    return this.fetchImpl(`https://api.notion.com${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }
}
