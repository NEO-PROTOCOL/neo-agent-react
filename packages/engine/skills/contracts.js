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
