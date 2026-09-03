import { GoogleGenerativeAI } from "@google/generative-ai";
import { ProviderAdapter } from "./ProviderAdapter.js";

const DEFAULT_TIMEOUT_MS = 60_000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout apos ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

export class GeminiProviderAdapter extends ProviderAdapter {
  constructor({ apiKey = process.env.GEMINI_API_KEY, defaultModel = "gemini-3.5-flash-lite" } = {}) {
    super({ id: "gemini", aliases: ["gemini-1.5-pro"] });
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
    this.client = apiKey ? new GoogleGenerativeAI(apiKey) : null;
  }

  isConfigured() {
    return Boolean(this.client);
  }

  async execute({
    model,
    systemInstruction,
    generationConfig,
    toolDeclarations = [],
    executeTool,
    maxToolCalls = 5,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }) {
    if (!this.client) throw new Error("Provider gemini nao configurado");

    const hasTools = toolDeclarations.length > 0;
    const providerModel = this.client.getGenerativeModel({
      model: model || this.defaultModel,
      systemInstruction,
      ...(hasTools ? { tools: [{ functionDeclarations: toolDeclarations }] } : {}),
    });

    let contents = [{ role: "user", parts: [{ text: "INICIE A EXECUCAO DA MISSAO." }] }];
    let toolCallsCount = 0;
    let rawResponse = "";
    let metadata = {};

    for (let iteration = 0; iteration < maxToolCalls + 1; iteration += 1) {
      const { response } = await withTimeout(
        providerModel.generateContent({ contents, generationConfig }),
        timeoutMs,
        "generateContent"
      );

      const modelParts = response.candidates?.[0]?.content?.parts || [];
      metadata = {
        provider: this.id,
        model: model || this.defaultModel,
        model_version: response.modelVersion || null,
        finish_reason: response.candidates?.[0]?.finishReason || null,
        usage: {
          prompt_tokens: response.usageMetadata?.promptTokenCount ?? null,
          output_tokens: response.usageMetadata?.candidatesTokenCount ?? null,
          thinking_tokens: response.usageMetadata?.thoughtsTokenCount ?? null,
          total_tokens: response.usageMetadata?.totalTokenCount ?? null,
        },
      };
      try {
        rawResponse = response.text();
      } catch {
        rawResponse = "";
      }

      if (!hasTools) break;

      const functionCalls = modelParts.map((part) => part.functionCall).filter(Boolean);
      if (!functionCalls.length) break;
      if (!executeTool) throw new Error("Tool-calling habilitado sem executeTool");
      if (toolCallsCount + functionCalls.length > maxToolCalls) {
        throw new Error(`Limite de tool calls excedido (${maxToolCalls})`);
      }

      const functionResponses = [];
      for (const call of functionCalls) {
        toolCallsCount += 1;
        const result = await executeTool(call.name, call.args || {});
        functionResponses.push({
          functionResponse: { name: call.name, response: result },
        });
      }

      contents = [
        ...contents,
        { role: "model", parts: modelParts },
        { role: "user", parts: functionResponses },
      ];
    }

    return { text: rawResponse, metadata };
  }
}
