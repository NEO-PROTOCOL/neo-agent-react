import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntimeDocuments } from "../../../packages/engine/pilot/adapters.js";

test("runtime carrega doutrina empacotada sem caminho do Mac", async () => {
  const doctrine = await loadRuntimeDocuments();
  assert.equal(doctrine.documents.length, 5);
  assert.match(doctrine.version, /^[a-f0-9]{64}$/);
  assert.ok(doctrine.documents.every((document) => document.content.trim().length > 0));
});
