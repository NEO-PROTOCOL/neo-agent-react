import { z } from "zod";

const SkillRefSchema = z.union([
  z.string().min(1),
  z.object({
    name: z.string().min(1),
    params: z.record(z.any()).default({}),
  }),
]);

const DocumentSchema = z.object({
  name: z.string().min(1),
  content: z.string(),
});

export const NeoAgentSchema = z.object({
  id: z.string().min(1),
  type: z.literal("agent"),
  provider: z.string().min(1),
  model: z.string().min(1).optional(),
  config: z
    .object({
      temperature: z.number().min(0).max(1).default(0.2),
      maxTokens: z.number().int().positive().optional(),
    })
    .default({ temperature: 0.2 }),
  systemConfig: z.object({
    role: z.string().min(1),
    mission: z.string().min(1),
    constraints: z.array(z.string()).default([]),
    outputType: z.enum(["text", "json", "markdown"]),
    outputSchema: z.record(z.any()).optional(),
    requiredContextKeys: z.array(z.string()).optional(),
    allowModelToolCalling: z.boolean().default(false),
    toolAllowlist: z.array(z.string()).default([]),
    maxToolCalls: z.number().int().min(1).max(20).default(5),
  }),
  skills: z.array(SkillRefSchema).default([]),
  documents: z.array(DocumentSchema).optional().default([]),
});

export function parseAgentConfig(rawConfig) {
  return NeoAgentSchema.parse(rawConfig);
}
