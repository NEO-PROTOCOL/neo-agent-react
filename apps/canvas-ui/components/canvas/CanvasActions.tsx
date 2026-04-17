"use client";

import { useReactFlow } from "reactflow";

interface Props {
  onLayout: () => void;
}

const BTN_BASE = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.07)",
};
const BTN_HOVER = {
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.14)",
};

export default function CanvasActions({ onLayout }: Props) {
  const { fitView } = useReactFlow();

  return (
    <div
      className="flex flex-col gap-1 rounded-xl p-1"
      style={{
        background: "rgba(10, 10, 12, 0.80)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.07)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}
    >
      <Btn
        title="Fit view  (Ctrl+Shift+F)"
        label="⤢"
        onClick={() => fitView({ padding: 0.15, duration: 400 })}
      />
      <Btn
        title="Auto-layout"
        label="⊞"
        onClick={onLayout}
      />
    </div>
  );
}

function Btn({ title, label, onClick }: { title: string; label: string; onClick: () => void }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex items-center justify-center w-8 h-8 rounded-lg text-white/40 hover:text-white/80 transition-colors text-base leading-none"
      style={BTN_BASE}
      onMouseEnter={(e) => Object.assign((e.currentTarget as HTMLElement).style, BTN_HOVER)}
      onMouseLeave={(e) => Object.assign((e.currentTarget as HTMLElement).style, BTN_BASE)}
    >
      {label}
    </button>
  );
}
