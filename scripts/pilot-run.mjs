#!/usr/bin/env node
import { readFile } from "node:fs/promises";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const inputPath = option("--input");
  const baseUrl = option("--base-url") || "http://127.0.0.1:4001";
  if (!inputPath) {
    throw new Error("Uso: pnpm pilot:run -- --input /caminho/week-task.json");
  }

  const raw = JSON.parse(await readFile(inputPath, "utf8"));
  if (!raw.task_id) throw new Error("week-task.json exige task_id");

  const response = await fetch(`${baseUrl}/pilot/tasks/${encodeURIComponent(raw.task_id)}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(raw),
  });
  const result = await response.json();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!response.ok || !result.ok) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Falha no trigger"}\n`);
  process.exitCode = 1;
});
