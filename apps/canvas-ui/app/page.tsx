"use client";

import { useEffect, useMemo, useState } from "react";
import "reactflow/dist/style.css";
import ReactFlow, {
  Background,
  Controls,
  type EdgeTypes,
  type Edge,
  type Node,
  type NodeTypes,
} from "reactflow";
import NeoAgentConfigurator from "@/components/NeoAgentConfigurator";
import NeoNode, { type NeoNodeData } from "@/components/canvas/nodes/NeoNode";
import NeoEdge from "@/components/canvas/edges/NeoEdge";
import { useNeoStore } from "@/store/useNeoStore";

const nodeTypes: NodeTypes = { agent: NeoNode, skill: NeoNode };
const edgeTypes: EdgeTypes = { default: NeoEdge };

const FLOW_ID = "neo_flow_01";

export default function HomePage() {
  const [isMounted, setIsMounted] = useState(false);
  const { nodes, edges, initGraph, onNodesChange, onEdgesChange, onConnect, setNodeStatus, listenToFlow } =
    useNeoStore();

  const initialNodes = useMemo<Node<NeoNodeData>[]>(
    () => [
      {
        id: "agent_placeholder",
        type: "agent",
        position: { x: 100, y: 160 },
        data: {
          label: "Configure um agente →",
          nodeType: "agent",
          executionStatus: "idle",
          memoryMode: "none",
        },
      },
    ],
    []
  );

  const initialEdges = useMemo<Edge[]>(() => [], []);

  useEffect(() => { setIsMounted(true); }, []);

  useEffect(() => {
    if (nodes.length === 0) initGraph(initialNodes, initialEdges);
  }, [nodes.length, initGraph, initialNodes, initialEdges]);

  useEffect(() => {
    return listenToFlow(FLOW_ID);
  }, [listenToFlow]);

  const handleExecuteStart = (agentId: string) => {
    const exists = nodes.find((n) => n.id === agentId);
    if (!exists) {
      // add new node to canvas for this agent
      const { initGraph: ig } = useNeoStore.getState();
      const updatedNodes: Node<NeoNodeData>[] = [
        ...nodes.filter((n) => n.id !== "agent_placeholder"),
        {
          id: agentId,
          type: "agent",
          position: { x: 100 + nodes.length * 60, y: 160 },
          data: {
            label: agentId,
            nodeType: "agent",
            executionStatus: "running",
            memoryMode: "redis_sync",
          },
        },
      ];
      ig(updatedNodes, edges);
    }
    setNodeStatus(agentId, "running");
  };

  const handleExecuteDone = (agentId: string, ok: boolean) => {
    setNodeStatus(agentId, ok ? "success" : "error");
  };

  return (
    <main className="h-screen bg-[#050505] text-gray-200 flex flex-col overflow-hidden">

      {/* top bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#111] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold tracking-widest text-[#39FF14]">NEO</span>
          <span className="text-[#333]">/</span>
          <span className="text-sm text-gray-500 tracking-wide">Agent Canvas</span>
        </div>
        <span className="text-[10px] text-[#333] font-mono">
          flow: <span className="text-[#555]">{FLOW_ID}</span>
        </span>
      </header>

      {/* body: split */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── left: configurator ── */}
        <aside className="w-[520px] shrink-0 border-r border-[#111] p-5 overflow-y-auto bg-[#080808]">
          <p className="text-[10px] uppercase tracking-widest text-[#333] mb-4">Module Builder</p>
          <NeoAgentConfigurator
            flowId={FLOW_ID}
            onExecuteStart={handleExecuteStart}
            onExecuteDone={handleExecuteDone}
          />
        </aside>

        {/* ── right: canvas ── */}
        <section className="flex-1 relative">
          {isMounted ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              fitView
            >
              <Background color="#111" gap={24} />
              <Controls />
            </ReactFlow>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[#333]">
              Carregando canvas...
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
