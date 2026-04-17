"use client";

import { useMemo, useState } from "react";

type LLMProvider = "gemini-1.5-pro" | "gpt-4o" | "llama-3-local";
type MemoryType = "redis_sync" | "vector_store" | "none";
type Skill = "web_search" | "python_exec" | "db_write";

export default function NeoAgentConfigurator() {
  const [provider, setProvider] = useState<LLMProvider>("gemini-1.5-pro");
  const [memory, setMemory] = useState<MemoryType>("redis_sync");
  const [skills, setSkills] = useState<Set<Skill>>(new Set());

  const toggleSkill = (skill: Skill) => {
    setSkills((prev) => {
      const next = new Set(prev);
      if (next.has(skill)) next.delete(skill);
      else next.add(skill);
      return next;
    });
  };

  const exportPayload = useMemo(() => {
    return {
      id: `neo_node_${Math.random().toString(36).slice(2, 8)}`,
      type: "agent",
      provider,
      config: {
        temperature: 0.7,
      },
      memory,
      skills: Array.from(skills),
    };
  }, [provider, memory, skills]);

  return (
    <div className="flex bg-[#0a0a0a] text-gray-300 min-h-[520px] font-mono p-6 gap-6 rounded-lg">
      <div className="w-1/2 bg-[#121212] border border-[#2a2a2a] rounded-lg p-6 shadow-[0_0_20px_rgba(57,255,20,0.05)]">
        <h2 className="text-[#39FF14] text-xl font-bold mb-6 tracking-widest border-b border-[#2a2a2a] pb-2">
          NEO_MODULE_BUILDER
        </h2>

        <div className="mb-6">
          <label className="block text-xs text-gray-500 mb-2 uppercase">Core Engine</label>
          <select
            className="w-full bg-black border border-[#333] rounded p-2 text-sm focus:border-[#39FF14] focus:outline-none transition-colors"
            value={provider}
            onChange={(e) => setProvider(e.target.value as LLMProvider)}
          >
            <option value="gemini-1.5-pro">Gemini 1.5 Pro (Multimodal)</option>
            <option value="gpt-4o">GPT-4 Omni</option>
            <option value="llama-3-local">Llama 3 (Local Edge)</option>
          </select>
        </div>

        <div className="mb-6">
          <label className="block text-xs text-gray-500 mb-2 uppercase">Memory Adapter</label>
          <select
            className="w-full bg-black border border-[#333] rounded p-2 text-sm focus:border-[#ac4bff] focus:outline-none transition-colors"
            value={memory}
            onChange={(e) => setMemory(e.target.value as MemoryType)}
          >
            <option value="redis_sync">Redis Sync (Short-term)</option>
            <option value="vector_store">Vector DB (Long-term RAG)</option>
            <option value="none">Stateless (No Memory)</option>
          </select>
        </div>

        <div className="mb-6">
          <label className="block text-xs text-gray-500 mb-2 uppercase">Capabilities (Skills)</label>
          <div className="flex flex-wrap gap-2">
            {(["web_search", "python_exec", "db_write"] as Skill[]).map((skill) => (
              <button
                key={skill}
                onClick={() => toggleSkill(skill)}
                className={`px-3 py-1 text-xs border rounded transition-all ${
                  skills.has(skill)
                    ? "border-[#39FF14] text-[#39FF14] bg-[#39FF14]/10"
                    : "border-[#333] text-gray-500 hover:border-gray-400"
                }`}
              >
                {skill}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="w-1/2 bg-[#121212] border border-[#2a2a2a] rounded-lg p-6 flex flex-col">
        <h2 className="text-gray-400 text-sm font-bold mb-4 uppercase tracking-widest flex justify-between">
          <span>Latent JSON Output</span>
          <span className="text-[10px] bg-[#333] px-2 py-1 rounded text-[#39FF14]">Ready for Railway</span>
        </h2>

        <pre className="flex-1 bg-black p-4 rounded border border-[#2a2a2a] text-[#ac4bff] text-xs overflow-auto">
          {JSON.stringify(exportPayload, null, 2)}
        </pre>

        <button
          className="mt-4 w-full bg-[#39FF14] text-black font-bold py-3 rounded hover:bg-white hover:shadow-[0_0_15px_rgba(57,255,20,0.5)] transition-all uppercase tracking-widest text-sm"
          onClick={() => {
            console.log("Enviando para o Redis...", exportPayload);
          }}
        >
          Push to Redis Bus
        </button>
      </div>
    </div>
  );
}
