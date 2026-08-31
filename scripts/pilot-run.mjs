#!/usr/bin/env node
import { readFile } from "node:fs/promises";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const inputPath = option("--input");
  const baseUrl = option("--base-url") || "http://127.0.0.1:4001";
  const apiKey = option("--api-key") || process.env.RUNTIME_API_KEY;
  const wait = process.argv.includes("--wait");
  if (!inputPath) {
    throw new Error("Uso: pnpm pilot:run -- --input /caminho/week-task.json");
  }
  if (!apiKey) throw new Error("RUNTIME_API_KEY e obrigatoria");

  const raw = JSON.parse(await readFile(inputPath, "utf8"));
  if (!raw.task_id) throw new Error("week-task.json exige task_id");

  const response = await fetch(`${baseUrl}/pilot/tasks/${encodeURIComponent(raw.task_id)}/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(raw),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }
  if (!wait) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const deadline = Date.now() + Number(option("--timeout-ms") || 120_000);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const stateResponse = await fetch(
      `${baseUrl}/pilot/tasks/${encodeURIComponent(raw.task_id)}`,
      { headers: { authorization: `Bearer ${apiKey}` } }
    );
    if (!stateResponse.ok) continue;
    const state = await stateResponse.json();
    if (state.state?.approval) {
      process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
      return;
    }
  }
  throw new Error("Timeout aguardando conclusao da task");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Falha no trigger"}\n`);
  process.exitCode = 1;
});
