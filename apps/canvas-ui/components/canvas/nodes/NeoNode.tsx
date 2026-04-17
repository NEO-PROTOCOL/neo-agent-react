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
  apiKit?: string;
}

const STATUS_DOT: Record<NodeStatus, string> = {
  idle:    "bg-[#333]",
  running: "bg-[#ac4bff] shadow-[0_0_8px_#ac4bff] animate-pulse",
  success: "bg-[#39FF14] shadow-[0_0_8px_#39FF14]",
  error:   "bg-[#ff2255] shadow-[0_0_8px_#ff2255]",
};

const STATUS_BORDER: Record<NodeStatus, string> = {
  idle:    "border-white/[0.07]",
  running: "border-[#ac4bff]/40",
  success: "border-[#39FF14]/35",
  error:   "border-[#ff2255]/40",
};

const STATUS_GLOW: Record<NodeStatus, string> = {
  idle:    "",
  running: "glow-purple",
  success: "glow-green",
  error:   "glow-red",
};

const STATUS_LABEL: Record<NodeStatus, string> = {
  idle:    "IDLE",
  running: "RUNNING",
  success: "SUCCESS",
  error:   "ERROR",
};

const STATUS_TEXT: Record<NodeStatus, string> = {
  idle:    "text-white/20",
  running: "text-[#ac4bff]",
  success: "text-[#39FF14]",
  error:   "text-[#ff2255]",
};

const NeoNode = ({ data, selected }: NodeProps<NeoNodeData>) => {
  const status = data.executionStatus ?? "idle";

  return (
    <div
      className={`
        relative min-w-[220px] rounded-xl shimmer-top
        glass transition-all duration-300 cursor-pointer
        ${STATUS_BORDER[status]} ${STATUS_GLOW[status]}
        ${selected ? "!border-[#39FF14]/60 ring-1 ring-[#39FF14]/30" : ""}
      `}
    >
      {/* header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.05]">
        <span className="text-[9px] font-mono tracking-[0.2em] text-white/30 uppercase">
          [{data.nodeType}]
        </span>
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />
          <span className={`text-[9px] font-mono tracking-widest uppercase ${STATUS_TEXT[status]}`}>
            {STATUS_LABEL[status]}
          </span>
        </div>
      </div>

      {/* body */}
      <div className="px-3 py-3">
        <p className="text-sm font-semibold text-white/90 leading-snug mb-3">
          {data.label}
        </p>

        <div className="space-y-1.5">
          {data.memoryMode && (
            <Row label="MEM" value={data.memoryMode} valueClass="text-[#39FF14]" />
          )}
          {data.apiKit && (
            <Row label="API" value={data.apiKit} valueClass="text-[#ac4bff]" />
          )}
          {data.latency && (
            <Row label="LAT" value={data.latency} valueClass="text-[#ac4bff]" />
          )}
          {typeof data.tokens === "number" && (
            <Row label="TOK" value={String(data.tokens)} valueClass="text-white/50" />
          )}
        </div>

        {status === "idle" && (
          <p className="mt-3 text-[9px] text-white/18 font-mono tracking-widest">
            CLICK TO CONFIGURE
          </p>
        )}
      </div>

      {/* handles */}
      <Handle
        type="target"
        position={Position.Left}
        className={`!w-2.5 !h-2.5 !rounded-full !border-2 !bg-[#0a0a0a] transition-all duration-300 ${
          status === "running" ? "!border-[#ac4bff] !shadow-[0_0_8px_#ac4bff]" : "!border-white/20"
        }`}
      />
      <Handle
        type="source"
        position={Position.Right}
        className={`!w-2.5 !h-2.5 !rounded-full !border-2 !bg-[#0a0a0a] transition-all duration-300 ${
          status === "success" ? "!border-[#39FF14] !shadow-[0_0_8px_#39FF14]" : "!border-white/20"
        }`}
      />
    </div>
  );
};

function Row({ label, value, valueClass }: { label: string; value: string; valueClass: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[9px] font-mono text-white/25 tracking-widest">{label}</span>
      <span className={`text-[10px] font-mono ${valueClass}`}>{value}</span>
    </div>
  );
}

export default memo(NeoNode);
