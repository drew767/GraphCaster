// Copyright GraphCaster. All Rights Reserved.

import { Handle, Position } from "@xyflow/react";
import { memo } from "react";

import type { GcNodeData } from "../../graph/toReactFlow";

import { LODLevel } from "./hooks/useLODLevel";

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

  if (lodLevel === LODLevel.GHOST) {
    return (
      <div
        data-testid="node-ghost"
        className="gc-lod-node gc-lod-node--ghost"
        style={{
          width: 160,
          height: 40,
          backgroundColor: getNodeColor(kind),
          opacity: 0.3,
          borderRadius: 4,
        }}
      />
    );
  }

  if (lodLevel === LODLevel.LOW) {
    return (
      <div
        data-testid="node-shape"
        className="gc-lod-node gc-lod-node--low"
        style={{
          width: 160,
          height: 40,
          backgroundColor: getNodeColor(kind),
          borderRadius: 4,
          border: selected ? "2px solid #3b82f6" : "1px solid #ccc",
        }}
      >
        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
      </div>
    );
  }

  if (lodLevel === LODLevel.MEDIUM) {
    return (
      <div
        className="gc-lod-node gc-lod-node--medium"
        style={{
          width: 160,
          padding: "8px 12px",
          backgroundColor: getNodeColor(kind),
          borderRadius: 4,
          border: selected ? "2px solid #3b82f6" : "1px solid #ccc",
        }}
      >
        <Handle type="target" position={Position.Left} />
        <div style={{ fontWeight: 500, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>
          {data.label}
        </div>
        <Handle type="source" position={Position.Right} />
      </div>
    );
  }

  return (
    <div
      className="gc-lod-node gc-lod-node--high"
      style={{
        width: 200,
        padding: "12px 16px",
        backgroundColor: getNodeColor(kind),
        borderRadius: 6,
        border: selected ? "2px solid #3b82f6" : "1px solid #ccc",
        boxShadow: selected ? "0 2px 8px rgba(0,0,0,0.15)" : "none",
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{data.label}</div>
      <div data-testid="node-details" style={{ fontSize: 11, color: "#666" }}>
        {kind}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
