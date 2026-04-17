"use client";

interface NodeDef {
  kind: string;
  label: string;
  icon: string;
  color: string;
  nodeType: string;
  apiKit?: string;
}

const NODE_TYPES: NodeDef[] = [
  { kind: "agent",       label: "Agent",       icon: "◈", color: "#ac4bff", nodeType: "agent" },
  { kind: "skill",       label: "Skill",        icon: "⬡", color: "#39FF14", nodeType: "skill" },
  { kind: "api-pix",     label: "PIX / FlowPay",icon: "⬢", color: "#f59e0b", nodeType: "api",   apiKit: "flowpay-pix" },
  { kind: "api-nft",     label: "Smart-NFT",    icon: "⬡", color: "#22d3ee", nodeType: "api",   apiKit: "neo-smart-factory" },
  { kind: "api-http",    label: "HTTP API",     icon: "⟡", color: "#6b7280", nodeType: "api" },
  { kind: "orchestrator",label: "Orchestrator", icon: "⊕", color: "#39FF14", nodeType: "orchestrator" },
  { kind: "trigger",     label: "Trigger",      icon: "⚡", color: "#f97316", nodeType: "trigger" },
];

interface Props {
  onAdd: (def: NodeDef) => void;
}

export default function NodeToolbar({ onAdd }: Props) {
  return (
    <div
      className="absolute left-4 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-1.5 rounded-2xl p-2"
      style={{
        background: "rgba(10, 10, 12, 0.80)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.07)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)",
      }}
    >
      <p className="text-[8px] font-mono tracking-[0.2em] text-white/20 uppercase text-center mb-1 px-1">
        ADD
      </p>

      {NODE_TYPES.map((def) => (
        <button
          key={def.kind}
          onClick={() => onAdd(def)}
          title={def.label}
          className="group relative flex flex-col items-center justify-center w-10 h-10 rounded-xl transition-all duration-150 hover:scale-105"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = `${def.color}12`;
            (e.currentTarget as HTMLElement).style.borderColor = `${def.color}40`;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)";
          }}
        >
          <span className="text-lg leading-none" style={{ color: def.color }}>
            {def.icon}
          </span>

          {/* tooltip */}
          <span
            className="absolute left-full ml-3 px-2.5 py-1 rounded-md text-[10px] font-mono whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            style={{
              background: "rgba(10,10,12,0.95)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: def.color,
            }}
          >
            {def.label}
          </span>
        </button>
      ))}

      <div className="w-6 h-px bg-white/[0.06] mx-auto my-0.5" />

      {/* flow ID indicator */}
      <div className="w-10 h-2 flex items-center justify-center">
        <div className="w-1 h-1 rounded-full bg-[#39FF14] shadow-[0_0_4px_#39FF14]" />
      </div>
    </div>
  );
}

export type { NodeDef };
