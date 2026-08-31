import assert from "node:assert/strict";
import test from "node:test";
import { NotionSourceAdapter } from "../lib/NotionSourceAdapter.js";

function notionPage(id, revision, title) {
  return {
    id,
    last_edited_time: revision,
    properties: {
      Name: { type: "title", title: [{ plain_text: title }] },
      "Acceptance Criteria": {
        type: "rich_text",
        rich_text: [{ plain_text: "Primeiro criterio\n- Segundo criterio" }],
      },
      Constraints: { type: "multi_select", multi_select: [{ name: "Sem escrita" }] },
    },
  };
}

test("Notion adapter pagina, normaliza WeekIntent e nunca escreve", async () => {
  const requests = [];
  const responses = [
    {
      results: [notionPage("page-1", "2026-08-30T10:00:00.000Z", "Planejar semana")],
      has_more: true,
      next_cursor: "cursor-2",
    },
    {
      results: [notionPage("page-2", "2026-08-30T11:00:00.000Z", "Fechar semana")],
      has_more: false,
      next_cursor: null,
    },
  ];
  const adapter = new NotionSourceAdapter({
    apiKey: "test-notion-key",
    dataSourceId: "source-1",
    statusProperty: "Status",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 200, json: async () => responses.shift() };
    },
  });

  const result = await adapter.listWeekIntents({ editedAfter: "2026-08-29T00:00:00.000Z" });

  assert.equal(result.status, "ok");
  assert.equal(result.intents.length, 2);
  assert.equal(result.intents[0].intention, "Planejar semana");
  assert.deepEqual(result.intents[0].acceptance_criteria, ["Primeiro criterio", "Segundo criterio"]);
  assert.deepEqual(result.intents[0].constraints, ["Sem escrita"]);
  assert.match(result.intents[0].task_id, /^notion-/);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.init.method === "POST"));
  assert.equal(JSON.parse(requests[1].init.body).start_cursor, "cursor-2");
  assert.equal(requests[0].init.headers["notion-version"], "2026-03-11");
});

test("Notion adapter fica disabled sem data source e valida credencial sem expor chave", async () => {
  let calledUrl;
  const adapter = new NotionSourceAdapter({
    apiKey: "test-notion-key",
    dataSourceId: undefined,
    fetchImpl: async (url) => {
      calledUrl = url;
      return { ok: true, status: 200 };
    },
  });
  assert.deepEqual(await adapter.listWeekIntents(), { status: "disabled", intents: [] });
  assert.deepEqual(await adapter.validateCredentials(), { ok: true, status: 200 });
  assert.equal(calledUrl, "https://api.notion.com/v1/users/me");
});
