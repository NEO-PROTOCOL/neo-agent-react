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

  // simulateFlow removed — was only used in early development and had no real use
  // If needed for demo/test: call setNodeStatus directly with a timer

  listenToFlow: (flowId) => {
    const { setNodeStatus } = get();
    const url = `/api/flow-stream?flowId=${encodeURIComponent(flowId)}`;
    let eventSource: EventSource | null = null;
    let retryDelay = 1_000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    function connect() {
      if (closed) return;
      eventSource = new EventSource(url);

      eventSource.onmessage = (event) => {
        retryDelay = 1_000; // reset backoff on successful message
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
        eventSource?.close();
        eventSource = null;
        if (closed) return;
        // Exponential backoff: 1s → 2s → 4s → 8s → 16s (max)
        const delay = Math.min(retryDelay, 16_000);
        retryDelay = delay * 2;
        console.warn(`[NEO_CLIENT] SSE desconectado. Reconectando em ${delay}ms...`);
        retryTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      eventSource?.close();
    };
  },
}));
