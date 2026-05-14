// Copyright GraphCaster. All Rights Reserved.

import { Handle, Position } from "@xyflow/react";
import { memo, useMemo } from "react";

import type { GcNodeData } from "../../graph/toReactFlow";

import { LODLevel } from "./hooks/useLODLevel";
import "./LODNodeRenderer.css";

export { LODLevel };

export type LODNodeRendererProps = {
  id: string;
  data: GcNodeData;
  selected: boolean;
  lodLevel: LODLevel;
};

function getNodeColor(kind: string): string {
  const colors: Record<string, string> = {
    start: "#e0f2fe",
    exit: "#fee2e2",
    task: "#fef3c7",
    graph_ref: "#e0e7ff",
    ai_route: "#f3e8ff",
    llm_agent: "#ecfdf5",
    agent: "#d1fae5",
    mcp_tool: "#ede9fe",
    http_request: "#cffafe",
    rag_query: "#ede9fe",
    rag_index: "#ddd6fe",
    delay: "#e2e8f0",
    debounce: "#fef3c7",
    wait_for: "#ccfbf1",
    set_variable: "#fae8ff",
    python_code: "#ecfccb",
    fork: "#cffafe",
    merge: "#cffafe",
  };
  return colors[kind] || "#f5f5f5";
}

export const LODNodeRenderer = memo(function LODNodeRenderer({
  data,
  selected,
  lodLevel,
}: LODNodeRendererProps) {
  const kind = data.graphNodeType || "task";

  // Background color is the only state-dependent inline style; static box geometry
  // (width/padding/border-radius) lives in LODNodeRenderer.css to avoid per-render
  // style object allocations across hundreds of nodes during canvas pan/zoom.
  const dynamicStyle = useMemo(
    () => ({ backgroundColor: getNodeColor(kind) }),
    [kind],
  );

  if (lodLevel === LODLevel.GHOST) {
    return (
      <div
        data-testid="node-ghost"
        className="gc-lod-node gc-lod-node--ghost"
        style={dynamicStyle}
      />
    );
  }

  if (lodLevel === LODLevel.LOW) {
    return (
      <div
        data-testid="node-shape"
        className={
          selected
            ? "gc-lod-node gc-lod-node--low gc-lod-node--selected"
            : "gc-lod-node gc-lod-node--low"
        }
        style={dynamicStyle}
      >
        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
      </div>
    );
  }

  if (lodLevel === LODLevel.MEDIUM) {
    return (
      <div
        className={
          selected
            ? "gc-lod-node gc-lod-node--medium gc-lod-node--selected"
            : "gc-lod-node gc-lod-node--medium"
        }
        style={dynamicStyle}
      >
        <Handle type="target" position={Position.Left} />
        <div className="gc-lod-node__label">{data.label}</div>
        <Handle type="source" position={Position.Right} />
      </div>
    );
  }

  return (
    <div
      className={
        selected
          ? "gc-lod-node gc-lod-node--high gc-lod-node--selected"
          : "gc-lod-node gc-lod-node--high"
      }
      style={dynamicStyle}
    >
      <Handle type="target" position={Position.Left} />
      <div className="gc-lod-node__label">{data.label}</div>
      <div data-testid="node-details" className="gc-lod-node__details">
        {kind}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
