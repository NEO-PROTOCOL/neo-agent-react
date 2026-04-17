import { createClient } from "redis";

export class NeoEngine {
  constructor(config) {
    this.redis = createClient({ url: process.env.REDIS_URL });
    this.workflow = config;
  }

  async init() {
    await this.redis.connect();
    console.log("[NEO] Engine Latente Iniciada.");
  }

  async close() {
    await this.redis.quit();
  }

  async getContext(flowId) {
    const data = await this.redis.get(`flow:${flowId}`);
    return data ? JSON.parse(data) : {};
  }

  async updateContext(flowId, newNodeData) {
    const current = await this.getContext(flowId);
    const updated = { ...current, ...newNodeData };
    await this.redis.set(`flow:${flowId}`, JSON.stringify(updated));
  }

  async runNode(nodeId, flowId) {
    const node = this.workflow?.nodes?.[nodeId];
    if (!node) {
      throw new Error(`Node ${nodeId} não encontrado no workflow`);
    }

    const context = await this.getContext(flowId);
    const paramsSource = node.params || node.config || {};
    const processedParams = this.resolveVariables(paramsSource, context);

    let output;
    if (node.type === "agent") {
      output = await this.callLLM(node.provider, processedParams, context);
    } else if (node.type === "skill") {
      output = await this.executeSkill(node.action, processedParams, context);
    } else {
      throw new Error(`Tipo de node inválido: ${node.type}`);
    }

    await this.updateContext(flowId, { [nodeId]: output });
    return output;
  }

  resolveVariables(obj, context) {
    return JSON.parse(
      JSON.stringify(obj).replace(/\{\{(.*?)\}\}/g, (match, path) => {
        const parts = path.trim().split(".");
        const value = parts.reduce((prev, curr) => prev?.[curr], context);
        return value ?? match;
      })
    );
  }

  async callLLM(provider, params, context) {
    return {
      provider,
      received: params,
      contextKeys: Object.keys(context || {}),
      at: new Date().toISOString(),
      note: "Stub local. Integrar SDK do provedor.",
    };
  }

  async executeSkill(action, params, context) {
    return {
      action,
      received: params,
      contextKeys: Object.keys(context || {}),
      at: new Date().toISOString(),
      note: "Stub local. Integrar runtime de skills.",
    };
  }
}
