import { SkillCallSchema } from "./skills/contracts.js";
import { BUILTIN_SKILLS } from "./skills/builtin.js";

export class SkillRegistry {
  constructor(skills = BUILTIN_SKILLS) {
    this.skills = new Map();
    skills.forEach((skill) => this.register(skill));
  }

  register(skill) {
    if (!skill?.name || typeof skill.run !== "function") {
      throw new Error("Skill inválida: esperado { name, run }");
    }
    this.skills.set(skill.name, skill);
  }

  has(name) {
    return this.skills.has(name);
  }

  get(name) {
    return this.skills.get(name);
  }

  listToolDeclarations(allowedNames = []) {
    const names = allowedNames.length ? allowedNames : Array.from(this.skills.keys());
    return names
      .map((name) => this.skills.get(name))
      .filter(Boolean)
      .map((skill) => ({
        name: skill.name,
        description: skill.description,
        parameters: skill.parametersSchema,
      }));
  }

  async execute(call, context) {
    const parsedCall = SkillCallSchema.parse(call);
    const skill = this.skills.get(parsedCall.name);
    if (!skill) {
      throw new Error(`Skill não registrada: ${parsedCall.name}`);
    }

    const data = await skill.run(parsedCall.params, context);
    return {
      skill: parsedCall.name,
      ok: true,
      data,
    };
  }
}
