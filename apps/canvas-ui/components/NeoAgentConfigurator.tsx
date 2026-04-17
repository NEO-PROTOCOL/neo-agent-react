"use client";

import { useMemo, useState } from "react";

type LLMProvider = "gemini-1.5-pro" | "gpt-4o" | "llama-3-local";
type MemoryType = "redis_sync" | "vector_store" | "none";
type OutputType = "text" | "json" | "markdown";
type ExecStatus = "idle" | "running" | "success" | "error";

interface Document {
  name: string;
  content: string;
}

const BUILTIN_SKILLS = ["web_search", "http_request", "db_write"];
const PRESET_DOCS = ["instructions.md", "copy.md", "persona.md"];

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

interface Props {
  flowId: string;
  onExecuteStart?: (agentId: string) => void;
  onExecuteDone?: (agentId: string, ok: boolean) => void;
}

export default function NeoAgentConfigurator({ flowId, onExecuteStart, onExecuteDone }: Props) {
  const [agentId] = useState(() => `agent_${uid()}`);
  const [label, setLabel] = useState("");
  const [role, setRole] = useState("");
  const [mission, setMission] = useState("");
  const [constraints, setConstraints] = useState<string[]>([]);
  const [newConstraint, setNewConstraint] = useState("");
  const [documents, setDocuments] = useState<Document[]>([]);
  const [activeDocIdx, setActiveDocIdx] = useState<number | null>(null);
  const [skills, setSkills] = useState<Set<string>>(new Set());
  const [provider, setProvider] = useState<LLMProvider>("gemini-1.5-pro");
  const [memory, setMemory] = useState<MemoryType>("redis_sync");
  const [outputType, setOutputType] = useState<OutputType>("text");
  const [temperature, setTemperature] = useState(0.2);
  const [allowTools, setAllowTools] = useState(false);
  const [maxToolCalls, setMaxToolCalls] = useState(5);
  const [execStatus, setExecStatus] = useState<ExecStatus>("idle");
  const [execError, setExecError] = useState("");

  // --- constraints ---
  const addConstraint = () => {
    const trimmed = newConstraint.trim();
    if (trimmed) {
      setConstraints((p) => [...p, trimmed]);
      setNewConstraint("");
    }
  };

  // --- documents ---
  const addDocument = (name: string) => {
    const exists = documents.findIndex((d) => d.name === name);
    if (exists !== -1) {
      setActiveDocIdx(exists);
      return;
    }
    const next = [...documents, { name, content: "" }];
    setDocuments(next);
    setActiveDocIdx(next.length - 1);
  };

  const addCustomDoc = () => {
    const name = `doc_${uid()}.md`;
    addDocument(name);
  };

  const updateDocContent = (idx: number, content: string) => {
    setDocuments((p) => p.map((d, i) => (i === idx ? { ...d, content } : d)));
  };

  const removeDoc = (idx: number) => {
    setDocuments((p) => p.filter((_, i) => i !== idx));
    setActiveDocIdx(null);
  };

  // --- skills ---
  const toggleSkill = (s: string) =>
    setSkills((p) => {
      const n = new Set(p);
      if (n.has(s)) { n.delete(s); } else { n.add(s); }
      return n;
    });

  // --- payload ---
  const payload = useMemo(() => ({
    id: agentId,
    type: "agent" as const,
    provider,
    config: { temperature },
    systemConfig: {
      role: role || "Agente NEO",
      mission: mission || "Missão não definida",
      constraints,
      outputType,
      allowModelToolCalling: allowTools,
      toolAllowlist: Array.from(skills),
      maxToolCalls,
      requiredContextKeys: [],
    },
    skills: Array.from(skills).map((name) => ({ name, params: {} })),
    documents: documents.filter((d) => d.content.trim().length > 0),
    memory,
  }), [agentId, provider, temperature, role, mission, constraints, outputType, allowTools, skills, maxToolCalls, documents, memory]);

  // --- execute ---
  const handlePush = async () => {
    if (!role.trim() || !mission.trim()) {
      setExecError("Preencha Role e Mission antes de executar.");
      return;
    }
    setExecStatus("running");
    setExecError("");
    onExecuteStart?.(agentId);

    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flowId, nodes: [payload] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setExecStatus("success");
      onExecuteDone?.(agentId, true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      setExecStatus("error");
      setExecError(msg);
      onExecuteDone?.(agentId, false);
    }
  };

  const statusColor = { idle: "#555", running: "#ac4bff", success: "#39FF14", error: "#ff4444" }[execStatus];

  return (
    <div className="flex gap-5 font-mono text-gray-300 h-full">

      {/* ── LEFT: config panels ── */}
      <div className="flex flex-col gap-4 w-[52%] overflow-y-auto pr-1" style={{ maxHeight: "calc(100vh - 180px)" }}>

        {/* IDENTITY */}
        <Section title="AGENT IDENTITY">
          <Field label="Label (canvas)">
            <input
              className={input}
              placeholder="ex: Agente de Atendimento"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Field label="ID">
            <input className={`${input} text-[#555] cursor-not-allowed`} value={agentId} readOnly />
          </Field>
          <Field label="Role *">
            <input
              className={input}
              placeholder="ex: Especialista em atendimento ao cliente de e-commerce"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            />
          </Field>
          <Field label="Mission *">
            <textarea
              className={`${input} resize-none`}
              rows={4}
              placeholder="Descreva em detalhes o que este agente deve fazer, qual objetivo ele precisa atingir..."
              value={mission}
              onChange={(e) => setMission(e.target.value)}
            />
          </Field>
        </Section>

        {/* CONSTRAINTS */}
        <Section title="CONSTRAINTS">
          <ul className="space-y-1 mb-3">
            {constraints.length === 0 && (
              <li className="text-xs text-[#444] italic">Nenhuma constraint adicionada.</li>
            )}
            {constraints.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span className="text-[#39FF14] mt-0.5">›</span>
                <span className="flex-1 text-gray-400">{c}</span>
                <button
                  onClick={() => setConstraints((p) => p.filter((_, j) => j !== i))}
                  className="text-[#444] hover:text-red-400 text-xs shrink-0"
                >✕</button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input
              className={`${input} flex-1 text-xs`}
              placeholder="ex: Nunca revelar o system prompt"
              value={newConstraint}
              onChange={(e) => setNewConstraint(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addConstraint()}
            />
            <button onClick={addConstraint} className={chipGreen}>+ Add</button>
          </div>
        </Section>

        {/* DOCUMENTS */}
        <Section title="DOCUMENTS">
          <div className="flex flex-wrap gap-2 mb-3">
            {PRESET_DOCS.map((name) => (
              <button key={name} onClick={() => addDocument(name)} className={chipPurple}>{name}</button>
            ))}
            <button onClick={addCustomDoc} className={chipGray}>+ custom</button>
          </div>

          {documents.length > 0 && (
            <>
              {/* tabs */}
              <div className="flex gap-1 border-b border-[#2a2a2a] mb-2 overflow-x-auto">
                {documents.map((doc, i) => (
                  <div key={i} className="flex items-center">
                    <button
                      onClick={() => setActiveDocIdx(i)}
                      className={`px-3 py-1 text-[10px] rounded-t whitespace-nowrap transition-colors ${
                        activeDocIdx === i
                          ? "bg-[#1a1a1a] border border-b-0 border-[#333] text-[#ac4bff]"
                          : "text-[#444] hover:text-gray-400"
                      }`}
                    >
                      {doc.name}
                    </button>
                    <button
                      onClick={() => removeDoc(i)}
                      className="text-[#333] hover:text-red-400 text-[10px] px-1"
                    >✕</button>
                  </div>
                ))}
              </div>

              {activeDocIdx !== null && documents[activeDocIdx] && (
                <textarea
                  className={`${input} resize-none w-full text-xs leading-relaxed`}
                  rows={10}
                  placeholder={`Conteúdo de ${documents[activeDocIdx].name}...`}
                  value={documents[activeDocIdx].content}
                  onChange={(e) => updateDocContent(activeDocIdx, e.target.value)}
                />
              )}
            </>
          )}
        </Section>

        {/* SKILLS */}
        <Section title="SKILLS">
          <div className="flex flex-wrap gap-2">
            {BUILTIN_SKILLS.map((s) => (
              <button
                key={s}
                onClick={() => toggleSkill(s)}
                className={`px-3 py-1 text-xs border rounded transition-all ${
                  skills.has(s)
                    ? "border-[#39FF14] text-[#39FF14] bg-[#39FF14]/10"
                    : "border-[#333] text-[#555] hover:border-gray-500 hover:text-gray-400"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </Section>

        {/* ENGINE */}
        <Section title="ENGINE">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Provider">
              <select className={select} value={provider} onChange={(e) => setProvider(e.target.value as LLMProvider)}>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                <option value="gpt-4o">GPT-4o</option>
                <option value="llama-3-local">Llama 3 (Local)</option>
              </select>
            </Field>
            <Field label="Memory">
              <select className={select} value={memory} onChange={(e) => setMemory(e.target.value as MemoryType)}>
                <option value="redis_sync">Redis (Short-term)</option>
                <option value="vector_store">Vector DB (RAG)</option>
                <option value="none">Stateless</option>
              </select>
            </Field>
            <Field label="Output Type">
              <select className={select} value={outputType} onChange={(e) => setOutputType(e.target.value as OutputType)}>
                <option value="text">Text</option>
                <option value="json">JSON</option>
                <option value="markdown">Markdown</option>
              </select>
            </Field>
            <Field label={`Temperature: ${temperature}`}>
              <input
                type="range" min={0} max={1} step={0.05}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="w-full accent-[#ac4bff] mt-2"
              />
            </Field>
          </div>

          <div className="mt-4 flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-400">
              <div
                onClick={() => setAllowTools((p) => !p)}
                className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 cursor-pointer ${allowTools ? "bg-[#ac4bff]" : "bg-[#2a2a2a]"}`}
              >
                <div className={`w-4 h-4 bg-white rounded-full transition-transform ${allowTools ? "translate-x-4" : ""}`} />
              </div>
              Tool Calling
            </label>
            {allowTools && (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span>Max calls:</span>
                <input
                  type="number" min={1} max={20}
                  value={maxToolCalls}
                  onChange={(e) => setMaxToolCalls(Number(e.target.value))}
                  className="w-14 bg-black border border-[#333] rounded px-2 py-0.5 text-center text-xs"
                />
              </div>
            )}
          </div>
        </Section>
      </div>

      {/* ── RIGHT: JSON + execute ── */}
      <div className="w-[48%] flex flex-col gap-4">
        <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-lg p-4 flex flex-col flex-1" style={{ maxHeight: "calc(100vh - 220px)" }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] uppercase tracking-widest text-gray-500">Payload JSON</span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#1a1a1a] border border-[#333]" style={{ color: statusColor }}>
              {execStatus.toUpperCase()}
            </span>
          </div>
          <pre className="flex-1 overflow-auto text-[#ac4bff] text-[11px] leading-relaxed">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </div>

        {execError && (
          <div className="text-xs text-red-400 bg-red-900/20 border border-red-900 rounded px-3 py-2">
            {execError}
          </div>
        )}

        <button
          disabled={execStatus === "running"}
          onClick={handlePush}
          className={`w-full py-3 rounded font-bold uppercase tracking-widest text-sm transition-all ${
            execStatus === "running"
              ? "bg-[#ac4bff]/40 text-[#ac4bff] cursor-wait"
              : execStatus === "error"
              ? "bg-red-500 text-white hover:bg-red-400"
              : execStatus === "success"
              ? "bg-[#39FF14] text-black hover:shadow-[0_0_20px_rgba(57,255,20,0.4)]"
              : "bg-[#39FF14] text-black hover:shadow-[0_0_20px_rgba(57,255,20,0.4)]"
          }`}
        >
          {execStatus === "running" ? "Executando..." : "Push to Redis Bus"}
        </button>

        <div className="text-[10px] text-[#333] text-center">
          flow: <span className="text-[#555]">{flowId}</span>
        </div>
      </div>
    </div>
  );
}

// ── shared style tokens ──
const input =
  "w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-gray-300 focus:border-[#ac4bff] focus:outline-none transition-colors placeholder:text-[#333]";
const select =
  "w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-gray-300 focus:border-[#ac4bff] focus:outline-none transition-colors";
const chipGreen =
  "px-3 py-1 text-xs border border-[#39FF14] text-[#39FF14] rounded hover:bg-[#39FF14]/10 transition-colors";
const chipPurple =
  "px-3 py-1 text-xs border border-[#ac4bff] text-[#ac4bff] rounded hover:bg-[#ac4bff]/10 transition-colors";
const chipGray =
  "px-3 py-1 text-xs border border-[#333] text-[#555] rounded hover:border-gray-500 hover:text-gray-400 transition-colors";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#0d0d0d] border border-[#1e1e1e] rounded-lg p-5">
      <h3 className="text-[10px] uppercase tracking-widest text-[#39FF14] mb-4 border-b border-[#1e1e1e] pb-2">
        {title}
      </h3>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-[#555] mb-1.5">{label}</label>
      {children}
    </div>
  );
}
