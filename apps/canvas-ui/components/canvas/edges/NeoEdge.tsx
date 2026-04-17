"use client";

import { memo } from "react";
import { BaseEdge, getSmoothStepPath, type EdgeProps } from "reactflow";

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

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  const aesthetics = {
    color: "#ac4bff",
    glowWidth: 6,
    baseWidth: 1,
    activeWidth: 2,
  };

  if (isActive) {
    return (
      <g className="react-flow__edge-neo-active">
        <BaseEdge
          path={edgePath}
          markerEnd={markerEnd}
          style={{
            ...style,
            stroke: aesthetics.color,
            strokeWidth: aesthetics.glowWidth,
            strokeOpacity: 0.2,
            filter: "drop-shadow(0 0 5px #ac4bff)",
          }}
        />

        <BaseEdge
          path={edgePath}
          id={id}
          style={{
            ...style,
            stroke: aesthetics.color,
            strokeWidth: aesthetics.activeWidth,
            strokeDasharray: "10 10",
            animation: "neo-energy-flow 1s linear infinite",
          }}
        />
      </g>
    );
  }

  return (
    <BaseEdge
      path={edgePath}
      id={id}
      markerEnd={markerEnd}
      style={{
        ...style,
        stroke: "#404040",
        strokeWidth: aesthetics.baseWidth,
        transition: "stroke 0.3s ease-in-out",
      }}
    />
  );
};

export default memo(NeoEdge);
