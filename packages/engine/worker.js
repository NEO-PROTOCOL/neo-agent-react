import { createClient } from "redis";
import { AgentRunner } from "./AgentRunner.js";
import { parseAgentConfig } from "./schemas/agentSchema.js";
import { StateReducer } from "./StateReducer.js";
import { SkillRegistry } from "./SkillRegistry.js";

// Keys that must never be traversed during template resolution
const PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export class NeoWorker {
  constructor() {
    // Instance-level clients — never shared across instances.
    // Using a stored Promise prevents concurrent connect() calls (TOCTOU fix).
    this._redis = createClient({ url: process.env.REDIS_URL });
    this._publisher = this._redis.duplicate();
    this._connectPromise = null;

    this.runner = new AgentRunner();
    this.stateReducer = new StateReducer();
    this.skillRegistry = new SkillRegistry();
  }

  async _ensureConnected() {
    if (!this._connectPromise) {
      this._connectPromise = Promise.all([
        this._redis.connect(),
        this._publisher.connect(),
      ]);
    }
    await this._connectPromise;
  }

  async broadcastStatus(flowId, nodeId, status, data = null) {
    await this._ensureConnected();
    const payload = JSON.stringify({ flowId, nodeId, status, data });
    await this._publisher.publish(`flow_updates:${flowId}`, payload);
    console.log(`[NEO_BUS] ${nodeId} -> ${status}`);
  }

  async getContext(flowId) {
    await this._ensureConnected();
    const contextRaw = await this._redis.hGetAll(`context:${flowId}`);
    return Object.fromEntries(
      Object.entries(contextRaw).map(([key, value]) => {
        try {
          return [key, JSON.parse(value)];
        } catch {
          return [key, value];
        }
      })
    );
  }

  async setContextField(flowId, key, value) {
    await this._ensureConnected();
    await this._redis.hSet(`context:${flowId}`, key, JSON.stringify(value));
  }

  async executeNode(flowId, nodeConfig) {
    await this._ensureConnected();
    const validatedNode = parseAgentConfig(nodeConfig);
    const { id: nodeId, systemConfig } = validatedNode;

    try {
      await this.broadcastStatus(flowId, nodeId, "running");

      const parsedContext = await this.getContext(flowId);
      const reducedContext = this.stateReducer.reduce(
        parsedContext,
        systemConfig.requiredContextKeys || []
      );

      const skillResults = await this._executeDeclaredSkills(
        flowId,
        nodeId,
        validatedNode.skills,
        reducedContext
      );
      const enrichedContext = { ...reducedContext, _skills: skillResults };

      const result = await this.runner.execute(validatedNode, enrichedContext, {
        listToolDeclarations: (allowlist) =>
          this.skillRegistry.listToolDeclarations(allowlist),
        executeTool: async (name, args) => {
          await this.broadcastStatus(flowId, nodeId, "tool_running", { tool: name, args });
          try {
            const executed = await this.skillRegistry.execute(
              { name, params: this._resolveVariables(args || {}, enrichedContext) },
              { flowId, nodeId, context: enrichedContext }
            );
            await this.broadcastStatus(flowId, nodeId, "tool_success", {
              tool: name,
              result: executed.data,
            });
            return executed.data;
          } catch (error) {
            const message = error instanceof Error ? error.message : "Erro de tool";
            await this.broadcastStatus(flowId, nodeId, "tool_error", { tool: name, message });
            throw error;
          }
        },
      });

      await this.setContextField(flowId, nodeId, result);
      await this.broadcastStatus(flowId, nodeId, "success", result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      await this.broadcastStatus(flowId, nodeId, "error", { message });
      throw error;
    }
  }

  async close() {
    await Promise.allSettled([this._publisher.quit(), this._redis.quit()]);
  }

  _resolveVariables(input, context) {
    if (!input || typeof input !== "object") return {};
    return JSON.parse(
      JSON.stringify(input).replace(/\{\{([\w.]+)\}\}/g, (match, path) => {
        const value = path
          .trim()
          .split(".")
          .filter((key) => !PROTO_KEYS.has(key)) // prototype pollution guard
          .reduce((acc, key) => (acc !== null && acc !== undefined ? acc[key] : undefined), context);

        if (value === undefined || value === null) return match;
        // Embed non-string values as JSON to keep the surrounding string valid
        if (typeof value === "string") return value;
        return JSON.stringify(value);
      })
    );
  }

  _normalizeSkillRef(ref) {
    if (typeof ref === "string") return { name: ref, params: {} };
    return { name: ref.name, params: ref.params || {} };
  }

  async _executeDeclaredSkills(flowId, nodeId, skillRefs, context) {
    const results = [];
    for (const skillRef of skillRefs || []) {
      const normalized = this._normalizeSkillRef(skillRef);
      const params = this._resolveVariables(normalized.params, context);
      await this.broadcastStatus(flowId, nodeId, "tool_running", { tool: normalized.name });
      try {
        const result = await this.skillRegistry.execute(
          { name: normalized.name, params },
          { flowId, nodeId, context }
        );
        await this.broadcastStatus(flowId, nodeId, "tool_success", {
          tool: normalized.name,
          result: result.data,
        });
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro de tool";
        await this.broadcastStatus(flowId, nodeId, "tool_error", {
          tool: normalized.name,
          message,
        });
        throw error;
      }
    }
    return results;
  }
}
