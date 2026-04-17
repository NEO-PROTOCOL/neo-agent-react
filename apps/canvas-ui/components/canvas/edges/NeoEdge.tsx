"use client";

import { memo, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from "reactflow";

export type EdgeStatus = "idle" | "active";

interface NeoEdgeData {
  flowStatus?: EdgeStatus;
  transferRate?: string;
}

type NeoEdgeProps = EdgeProps<NeoEdgeData>;

const NeoEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
  markerEnd,
}: NeoEdgeProps) => {
  const isActive = data?.flowStatus === "active";
  const [hovered, setHovered] = useState(false);
  const { setEdges } = useReactFlow();

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  const deleteEdge = () => setEdges((edges) => edges.filter((e) => e.id !== id));

  const hitArea = (
    <path
      d={edgePath}
      fill="none"
      stroke="transparent"
      strokeWidth={20}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ cursor: "pointer" }}
    />
  );

  if (isActive) {
    return (
      <>
        <g className="react-flow__edge-neo-active">
          <BaseEdge
            path={edgePath}
            markerEnd={markerEnd}
            style={{
              ...style,
              stroke: "#ac4bff",
              strokeWidth: 6,
              strokeOpacity: 0.2,
              filter: "drop-shadow(0 0 5px #ac4bff)",
            }}
          />
          <BaseEdge
            path={edgePath}
            id={id}
            style={{
              ...style,
              stroke: "#ac4bff",
              strokeWidth: 2,
              strokeDasharray: "10 10",
              animation: "neo-energy-flow 1s linear infinite",
            }}
          />
          {hitArea}
        </g>

        <EdgeLabelRenderer>
          {hovered && (
            <DeleteButton x={labelX} y={labelY} onDelete={deleteEdge} />
          )}
        </EdgeLabelRenderer>
      </>
    );
  }

  return (
    <>
      <g
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <BaseEdge
          path={edgePath}
          id={id}
          markerEnd={markerEnd}
          style={{
            ...style,
            stroke: hovered ? "#6b7280" : "#404040",
            strokeWidth: 1,
            transition: "stroke 0.2s ease-in-out",
          }}
        />
        {hitArea}
      </g>

      <EdgeLabelRenderer>
        {hovered && (
          <DeleteButton x={labelX} y={labelY} onDelete={deleteEdge} />
        )}
      </EdgeLabelRenderer>
    </>
  );
};

function DeleteButton({ x, y, onDelete }: { x: number; y: number; onDelete: () => void }) {
  return (
    <div
      style={{
        position: "absolute",
        transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
        pointerEvents: "all",
      }}
      className="nodrag nopan"
    >
      <button
        onClick={onDelete}
        className="flex items-center justify-center w-5 h-5 rounded-full text-white/60 hover:text-white text-xs leading-none transition-colors"
        style={{
          background: "rgba(10,10,12,0.92)",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
        }}
        title="Remove connection"
      >
        ×
      </button>
    </div>
  );
}

export default memo(NeoEdge);
