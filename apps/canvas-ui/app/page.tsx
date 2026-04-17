"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "reactflow/dist/style.css";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from "reactflow";
import NeoNode, { type NeoNodeData } from "@/components/canvas/nodes/NeoNode";
import NeoEdge from "@/components/canvas/edges/NeoEdge";
import CanvasActions from "@/components/canvas/CanvasActions";
import NodeToolbar, { type NodeDef } from "@/components/NodeToolbar";
import ConfiguratorDrawer from "@/components/ConfiguratorDrawer";
import { useNeoStore } from "@/store/useNeoStore";

const nodeTypes: NodeTypes = {
  agent: NeoNode, skill: NeoNode, api: NeoNode,
  orchestrator: NeoNode, trigger: NeoNode,
};
const edgeTypes: EdgeTypes = { default: NeoEdge };

const FLOW_ID = "neo_flow_01";

let _nodeCounter = 1;
function nextId(prefix: string) { return `${prefix}_${(_nodeCounter++).toString().padStart(2, "0")}`; }

export default function HomePage() {
  const [isMounted, setIsMounted] = useState(false);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const dotLayerRef   = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!dotLayerRef.current || !canvasWrapRef.current) return;
    const rect = canvasWrapRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const mask = `radial-gradient(520px circle at ${x}px ${y}px, black 0%, transparent 68%)`;
    dotLayerRef.current.style.maskImage = mask;
    dotLayerRef.current.style.webkitMaskImage = mask;
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!dotLayerRef.current) return;
    dotLayerRef.current.style.maskImage = "none";
    dotLayerRef.current.style.webkitMaskImage = "none";
  }, []);

  const {
    nodes, edges, addNode, initGraph,
    onNodesChange, onEdgesChange, onConnect,
    setNodeStatus, setSelectedNode, selectedNodeId,
    listenToFlow,
  } = useNeoStore();

  const initialNodes = useMemo<Node<NeoNodeData>[]>(() => [], []);

  useEffect(() => { setIsMounted(true); }, []);
  useEffect(() => { if (nodes.length === 0) initGraph(initialNodes, []); }, [nodes.length, initGraph, initialNodes]);
  useEffect(() => listenToFlow(FLOW_ID), [listenToFlow]);

  const handleAdd = useCallback((def: NodeDef) => {
    const id = nextId(def.nodeType);
    const offset = nodes.length * 30;
    addNode({
      id,
      type: def.nodeType,
      position: { x: 200 + offset, y: 160 + offset },
      data: {
        label: def.label,
        nodeType: def.nodeType,
        executionStatus: "idle",
        memoryMode: def.nodeType === "agent" ? "redis_sync" : undefined,
        apiKit: def.apiKit,
      } satisfies NeoNodeData,
    });
    setSelectedNode(id);
  }, [nodes.length, addNode, setSelectedNode]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node.id);
  }, [setSelectedNode]);

  const handleExecuteStart = useCallback((agentId: string) => {
    setNodeStatus(agentId, "running");
  }, [setNodeStatus]);

  const handleExecuteDone = useCallback((agentId: string, ok: boolean) => {
    setNodeStatus(agentId, ok ? "success" : "error");
  }, [setNodeStatus]);

  const handleLayout = useCallback(() => {
    if (nodes.length === 0) return;
    const cols = Math.ceil(Math.sqrt(nodes.length));
    const arranged = nodes.map((node, i) => ({
      ...node,
      position: { x: 80 + (i % cols) * 280, y: 80 + Math.floor(i / cols) * 180 },
    }));
    initGraph(arranged, edges);
  }, [nodes, edges, initGraph]);

  return (
    <main className="h-screen w-screen overflow-hidden relative bg-[#060606]">

      {/* top bar */}
      <header
        className="absolute top-0 inset-x-0 z-30 flex items-center justify-between px-5 h-11"
        style={{
          background: "rgba(6,6,8,0.85)",
          backdropFilter: "blur(16px)",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold tracking-[0.3em] text-[#39FF14]">NEO</span>
          <span className="text-white/15 text-xs">/</span>
          <span className="text-[11px] text-white/40 tracking-wide font-mono">Agent Canvas</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[9px] font-mono text-white/20 tracking-widest">
            FLOW <span className="text-white/35">{FLOW_ID}</span>
          </span>
          <div className="w-1.5 h-1.5 rounded-full bg-[#39FF14] shadow-[0_0_5px_#39FF14]" />
        </div>
      </header>

      {/* canvas */}
      <div
        ref={canvasWrapRef}
        className="absolute inset-0 pt-11"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* spotlight dot layer — visible only near the cursor via mask */}
        <div
          ref={dotLayerRef}
          className="absolute inset-0 z-[1] pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(210,215,230,0.52) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
            maskImage: "none",
            WebkitMaskImage: "none",
          }}
        />

        {isMounted ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={handleNodeClick}
            onPaneClick={() => setSelectedNode(null)}
            fitView={nodes.length > 0}
            minZoom={0.3}
            maxZoom={2}
            deleteKeyCode="Delete"
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={28}
              size={1}
              color="rgba(255,255,255,0.03)"
            />
            <Controls position="bottom-right" showInteractive={false} />
            <Panel position="bottom-left">
              <CanvasActions onLayout={handleLayout} />
            </Panel>
          </ReactFlow>
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] font-mono text-white/20 tracking-widest">
            INITIALIZING CANVAS...
          </div>
        )}

        {/* empty state */}
        {isMounted && nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <p className="text-[11px] font-mono tracking-[0.3em] text-white/15 uppercase">
              Add a module to start
            </p>
            <p className="text-[10px] font-mono text-white/08 mt-2">
              ← use the toolbar on the left
            </p>
          </div>
        )}
      </div>

      {/* floating toolbar */}
      {isMounted && (
        <div className="absolute inset-y-0 left-0 flex items-center pt-11 pointer-events-none z-30">
          <div className="pointer-events-auto">
            <NodeToolbar onAdd={handleAdd} />
          </div>
        </div>
      )}

      {/* configurator drawer */}
      <ConfiguratorDrawer
        flowId={FLOW_ID}
        nodeId={selectedNodeId}
        onClose={() => setSelectedNode(null)}
        onExecuteStart={handleExecuteStart}
        onExecuteDone={handleExecuteDone}
      />
    </main>
  );
}
