import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.argv[2] || process.env.NEO_AGENT_RUNTIME_ROOT;
if (!root) throw new Error("Provide neo-agent-runtime root as argv[2] or NEO_AGENT_RUNTIME_ROOT");

const names = [
  "gates/architecture-gate.md",
  "gates/destructive-gate.md",
  "gates/logic-gate.md",
  "policies/execution-doctrine.md",
  "policies/scope-control.md",
];
const documents = [];
const hash = createHash("sha256");

for (const name of names) {
  const content = await readFile(resolve(root, name), "utf8");
  if (!content.trim()) throw new Error(`Empty doctrine document: ${name}`);
  hash.update(name).update("\0").update(content).update("\0");
  documents.push({ name, content });
}

const bundle = {
  schema_version: "doctrine.bundle.v1",
  source: "neo-agent-runtime",
  version: hash.digest("hex"),
  documents,
};
await writeFile(
  new URL("../packages/engine/pilot/doctrine.bundle.json", import.meta.url),
  `${JSON.stringify(bundle, null, 2)}\n`
);
process.stdout.write(`${JSON.stringify({ event: "doctrine_bundle_built", version: bundle.version })}\n`);
