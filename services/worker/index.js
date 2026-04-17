import { NeoWorker } from "../../packages/engine/worker.js";

const flowNodes = [
  {
    id: "node_a",
    type: "agent",
    provider: "gemini-1.5-pro",
    config: { temperature: 0.2, maxTokens: 512 },
    systemConfig: {
      role: "Extrator de Arbitragem",
      mission: "Extrair oportunidades objetivas do contexto recebido.",
      constraints: [
        "Nao inventar dados fora do contexto.",
        "Retornar apenas campos pedidos.",
      ],
      outputType: "json",
      allowModelToolCalling: true,
      toolAllowlist: ["web_search"],
      maxToolCalls: 3,
      outputSchema: {
        type: "object",
        properties: {
          opportunities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                symbol: { type: "string" },
                spread: { type: "number" },
              },
              required: ["symbol", "spread"],
            },
          },
        },
        required: ["opportunities"],
      },
    },
    skills: [{ name: "web_search", params: { query: "arbitragem cripto hoje" } }],
  },
  {
    id: "node_b",
    type: "agent",
    provider: "gemini-1.5-pro",
    config: { temperature: 0.2, maxTokens: 512 },
    systemConfig: {
      role: "Sintetizador de Narrativa",
      mission: "Gerar resumo operacional para execucao com base em oportunidades.",
      constraints: ["Seja conciso", "Foque em acao imediata"],
      outputType: "markdown",
      allowModelToolCalling: true,
      toolAllowlist: ["db_write"],
      maxToolCalls: 2,
      requiredContextKeys: ["node_a.opportunities"],
    },
    skills: [{ name: "db_write", params: { table: "agent_reports", record: { source: "{{node_a}}" } } }],
  },
];

async function main() {
  const flowId = process.env.FLOW_ID || "local_test_flow";
  const worker = new NeoWorker();

  for (const node of flowNodes) {
    await worker.executeNode(flowId, node);
  }

  console.log("[NEO] Fluxo pub/sub finalizado", { flowId, processed: flowNodes.length });
  await worker.close();
}

main().catch((err) => {
  console.error("[NEO] Worker error", err);
  process.exit(1);
});
