import { z } from "zod";

export const SkillCallSchema = z.object({
  name: z.string().min(1),
  params: z.record(z.any()).default({}),
});

export const SkillResultSchema = z.object({
  ok: z.boolean(),
  data: z.any().optional(),
  error: z.string().optional(),
});

export function defineSkill(definition) {
  return {
    name: definition.name,
    description: definition.description || "",
    parametersSchema: definition.parametersSchema || {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
    run: definition.run,
  };
}

export class SkillRegistry {
  constructor() {
    this.skills = new Map();
  }

  register(skill) {
    if (!skill?.name || typeof skill?.run !== "function") {
      throw new Error(`Skill inválida: ${JSON.stringify(skill)}`);
    }
    this.skills.set(skill.name, skill);
  }

  get(name) {
    return this.skills.get(name);
  }

  list() {
    return Array.from(this.skills.values());
  }

  async execute(name, params, context = {}) {
    const skill = this.get(name);
    if (!skill) {
      return { ok: false, error: `Skill '${name}' não encontrada` };
    }
    try {
      const data = await skill.run(params, context);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }
}
