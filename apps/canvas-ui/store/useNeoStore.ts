"use client";

import { create } from "zustand";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from "reactflow";

export type NodeExecutionStatus = "idle" | "running" | "success" | "error";
export type EdgeFlowStatus = "idle" | "active";

const NODE_STATUSES = new Set<NodeExecutionStatus>(["idle", "running", "success", "error"]);

interface NeoState {
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  initGraph: (nodes: Node[], edges: Edge[]) => void;
  addNode: (node: Node) => void;
  setSelectedNode: (id: string | null) => void;
  setNodeStatus: (nodeId: string, status: NodeExecutionStatus) => void;
  setEdgeStatus: (edgeId: string, status: EdgeFlowStatus) => void;
  simulateFlow: (nodeId: string) => Promise<void>;
  listenToFlow: (flowId: string) => () => void;
}

export const useNeoStore = create<NeoState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,

  onNodesChange: (changes: NodeChange[]) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  onEdgesChange: (changes: EdgeChange[]) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: (connection: Connection) => {
    set({
      edges: addEdge(
        { ...connection, type: "default", data: { flowStatus: "idle" } },
        get().edges
      ),
    });
  },

  initGraph: (nodes, edges) => set({ nodes, edges }),

  addNode: (node) => set({ nodes: [...get().nodes, node] }),

  setSelectedNode: (id) => set({ selectedNodeId: id }),

  setNodeStatus: (nodeId, status) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, executionStatus: status } }
          : node
      ),
      edges: get().edges.map((edge) =>
        edge.target === nodeId
          ? { ...edge, data: { ...edge.data, flowStatus: status === "running" ? "active" : "idle" } }
          : edge
      ),
    });
  },

  setEdgeStatus: (edgeId, status) => {
    set({
      edges: get().edges.map((edge) =>
        edge.id === edgeId
          ? { ...edge, data: { ...edge.data, flowStatus: status } }
          : edge
      ),
    });
  },

  simulateFlow: async (nodeId) => {
    const { setNodeStatus } = get();
    setNodeStatus(nodeId, "running");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    setNodeStatus(nodeId, "success");
  },

  listenToFlow: (flowId) => {
    const { setNodeStatus } = get();
    const url = `/api/flow-stream?flowId=${encodeURIComponent(flowId)}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          nodeId?: unknown;
          status?: unknown;
          data?: unknown;
        };
        const nodeId = typeof payload.nodeId === "string" ? payload.nodeId : null;
        const status = typeof payload.status === "string" ? payload.status : null;
        if (nodeId && nodeId.length > 0 && status && NODE_STATUSES.has(status as NodeExecutionStatus)) {
          setNodeStatus(nodeId, status as NodeExecutionStatus);
        }
      } catch (error) {
        console.error("[NEO_CLIENT] Erro ao processar evento SSE", error);
      }
    };

    eventSource.onerror = () => {
      console.warn("[NEO_CLIENT] SSE desconectado do fluxo", flowId);
    };

    return () => eventSource.close();
  },
}));
