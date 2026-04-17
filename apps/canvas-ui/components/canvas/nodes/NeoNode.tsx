"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";

export type NodeStatus = "idle" | "running" | "success" | "error";

export interface NeoNodeData {
  label: string;
  nodeType: string;
  executionStatus?: NodeStatus;
  latency?: string;
  tokens?: number;
  memoryMode?: string;
}

const NeoNode = ({ data, selected }: NodeProps<NeoNodeData>) => {
  const status = data.executionStatus || "idle";

  const aesthetics: Record<
    NodeStatus,
    { border: string; glow: string; text: string; bg: string }
  > = {
    idle: {
      border: "border-[#2a2a2a]",
      glow: "",
      text: "text-gray-500",
      bg: "bg-[#121212]",
    },
    running: {
      border: "border-[#ac4bff]",
      glow: "shadow-[0_0_20px_rgba(172,75,255,0.4)] ring-1 ring-[#ac4bff]",
      text: "text-[#ac4bff] animate-pulse",
      bg: "bg-[#1a1025]",
    },
    success: {
      border: "border-[#39FF14]",
      glow: "shadow-[0_0_25px_rgba(57,255,20,0.25)]",
      text: "text-[#39FF14]",
      bg: "bg-[#0e1a10]",
    },
    error: {
      border: "border-[#ff1493]",
      glow: "shadow-[0_0_25px_rgba(255,20,147,0.4)] ring-1 ring-[#ff1493]",
      text: "text-[#ff1493]",
      bg: "bg-[#250d16]",
    },
  };

  const currentStyle = aesthetics[status];

  return (
    <div
      className={`relative min-w-[240px] rounded-lg transition-all duration-300 backdrop-blur-md ${currentStyle.bg} ${currentStyle.border} border-2 ${
        selected ? "ring-2 ring-[#39FF14] ring-offset-2 ring-offset-black" : currentStyle.glow
      }`}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent rounded-t-lg" />

      <div className="flex justify-between items-center px-4 py-2 border-b border-[#2a2a2a] bg-black/40 rounded-t-md">
        <span className="text-[10px] font-mono tracking-widest text-gray-400 uppercase">
          [{data.nodeType}]
        </span>
        <span className={`text-[10px] font-mono font-bold uppercase tracking-widest ${currentStyle.text}`}>
          {status === "running" ? "PROCESSING..." : status}
        </span>
      </div>

      <div className="p-4">
        <div className="text-sm font-semibold text-white mb-1 font-sans">{data.label}</div>

        <div className="flex flex-col gap-1 mt-3">
          {data.memoryMode && (
            <div className="flex justify-between text-[10px] font-mono text-gray-500">
              <span>MEM:</span>
              <span className="text-[#39FF14]">{data.memoryMode}</span>
            </div>
          )}
          {data.latency && (
            <div className="flex justify-between text-[10px] font-mono text-gray-500">
              <span>LATENCY:</span>
              <span className="text-[#ac4bff]">{data.latency}</span>
            </div>
          )}
          {typeof data.tokens === "number" && (
            <div className="flex justify-between text-[10px] font-mono text-gray-500">
              <span>TOKENS:</span>
              <span className="text-gray-300">{data.tokens}</span>
            </div>
          )}
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className={`!w-3 !h-3 !border-2 !bg-[#121212] transition-colors duration-300 ${
          status === "running" ? "!border-[#ac4bff] shadow-[0_0_10px_#ac4bff]" : "!border-gray-600"
        }`}
      />

      <Handle
        type="source"
        position={Position.Right}
        className={`!w-3 !h-3 !border-2 !bg-[#121212] transition-colors duration-300 ${
          status === "success" ? "!border-[#39FF14] shadow-[0_0_10px_#39FF14]" : "!border-gray-600"
        }`}
      />
    </div>
  );
};

export default memo(NeoNode);
