"use client";

import { useEffect, useRef } from "react";
import NeoAgentConfigurator from "@/components/NeoAgentConfigurator";

interface Props {
  flowId: string;
  nodeId: string | null;
  onClose: () => void;
  onExecuteStart?: (agentId: string) => void;
  onExecuteDone?: (agentId: string, ok: boolean) => void;
}

export default function ConfiguratorDrawer({ flowId, nodeId, onClose, onExecuteStart, onExecuteDone }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!nodeId) return null;

  return (
    <>
      {/* backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* drawer */}
      <div
        ref={ref}
        className="fixed right-0 top-0 bottom-0 z-50 w-[680px] max-w-[95vw] flex flex-col drawer-in"
        style={{
          background: "rgba(10, 10, 12, 0.88)",
          backdropFilter: "blur(28px) saturate(160%)",
          WebkitBackdropFilter: "blur(28px) saturate(160%)",
          borderLeft: "1px solid rgba(255,255,255,0.07)",
          boxShadow: "-20px 0 60px rgba(0,0,0,0.6), inset 1px 0 0 rgba(255,255,255,0.04)",
        }}
      >
        {/* drawer header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-[#39FF14] shadow-[0_0_6px_#39FF14]" />
            <span className="text-[11px] font-mono tracking-[0.25em] text-white/60 uppercase">
              Module Config
            </span>
            <span className="text-[10px] font-mono text-white/20">/ {nodeId}</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* drawer body */}
        <div className="flex-1 overflow-y-auto p-6">
          <NeoAgentConfigurator
            flowId={flowId}
            onExecuteStart={onExecuteStart}
            onExecuteDone={(id, ok) => { onExecuteDone?.(id, ok); if (ok) onClose(); }}
          />
        </div>
      </div>
    </>
  );
}
