"use client";

import { useEffect, useMemo, useState } from "react";
import "reactflow/dist/style.css";
import ReactFlow, {
  Background,
  Controls,
  type EdgeTypes,
  MarkerType,
  type Edge,
  type Node,
  type NodeTypes,
} from "reactflow";
import NeoAgentConfigurator from "@/components/NeoAgentConfigurator";
import NeoNode, { type NeoNodeData } from "@/components/canvas/nodes/NeoNode";
import NeoEdge from "@/components/canvas/edges/NeoEdge";
import { useNeoStore } from "@/store/useNeoStore";

const nodeTypes: NodeTypes = {
  agent: NeoNode,
  skill: NeoNode,
};

const edgeTypes: EdgeTypes = {
  default: NeoEdge,
};

export default function HomePage() {
  const flowId = "local_test_flow";
  const [isMounted, setIsMounted] = useState(false);
  const {
    nodes,
    edges,
    initGraph,
    onNodesChange,
    onEdgesChange,
    onConnect,
    simulateFlow,
    listenToFlow,
  } = useNeoStore();

  const initialNodes = useMemo<Node<NeoNodeData>[]>(
    () => [
      {
        id: "node_a",
        type: "agent",
        position: { x: 80, y: 80 },
        data: {
          label: "Arbitragem Controller",
          nodeType: "agent",
          executionStatus: "running",
          memoryMode: "redis_sync",
          latency: "122ms",
          tokens: 248,
        },
      },
      {
        id: "node_b",
        type: "skill",
        position: { x: 420, y: 90 },
        data: {
          label: "HTTP Request Skill",
          nodeType: "skill",
          executionStatus: "idle",
          memoryMode: "none",
        },
      },
    ],
    []
  );

  const initialEdges = useMemo<Edge[]>(
    () => [
      {
        id: "e_a_b",
        source: "node_a",
        target: "node_b",
        type: "default",
        markerEnd: { type: MarkerType.ArrowClosed, color: "#39FF14" },
        data: { flowStatus: "active", transferRate: "2.5KB/s" },
      },
    ],
    []
  );

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (nodes.length === 0) {
      initGraph(initialNodes, initialEdges);
    }
  }, [nodes.length, initGraph, initialNodes, initialEdges]);

  useEffect(() => {
    return listenToFlow(flowId);
  }, [flowId, listenToFlow]);

  return (
    <main className="min-h-screen bg-[#050505] p-6 text-gray-200">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold tracking-wide">NEO Agent Canvas</h1>
        <button
          className="rounded border border-[#39FF14] px-3 py-2 text-xs font-semibold text-[#39FF14] hover:bg-[#39FF14]/10"
          onClick={() => simulateFlow("node_b")}
        >
          Simular Fluxo em node_b
        </button>
      </div>

      <section className="mb-6">
        <NeoAgentConfigurator />
      </section>

      <section className="h-[540px] rounded-lg border border-[#222] overflow-hidden">
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
            <Background color="#1e1e1e" />
            <Controls />
          </ReactFlow>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            Carregando canvas...
          </div>
        )}
      </section>
    </main>
  );
}
