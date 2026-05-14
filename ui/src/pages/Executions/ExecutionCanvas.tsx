// Copyright GraphCaster. All Rights Reserved.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";

import type { ExecutionPayload } from "./executionsApi";
import { statusIconChar, statusTagColor } from "./executionStatus";

type Props = {
  execution: ExecutionPayload;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
};

function buildFlowNodes(execution: ExecutionPayload, selectedId: string | null): Node[] {
  return execution.nodes.map((n, idx) => ({
    id: n.id,
    type: "default",
    position: n.position ?? { x: idx * 220, y: 120 },
    data: {
      label: (
        <span>
          <span aria-hidden="true">{statusIconChar(n.status)}</span> {n.name}
        </span>
      ),
    },
    selected: n.id === selectedId,
    style: {
      borderColor: statusTagColor(n.status),
      borderWidth: 2,
    },
  }));
}

function buildFlowEdges(execution: ExecutionPayload): Edge[] {
  if (execution.edges && execution.edges.length > 0) {
    return execution.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
    }));
  }
  const edges: Edge[] = [];
  for (let i = 0; i < execution.nodes.length - 1; i++) {
    const a = execution.nodes[i];
    const b = execution.nodes[i + 1];
    edges.push({ id: `e-${a.id}-${b.id}`, source: a.id, target: b.id });
  }
  return edges;
}

export function ExecutionCanvas({ execution, selectedNodeId, onSelectNode }: Props) {
  const { t } = useTranslation();

  const nodes = useMemo(
    () => buildFlowNodes(execution, selectedNodeId),
    [execution, selectedNodeId],
  );
  const edges = useMemo(() => buildFlowEdges(execution), [execution]);

  const handleClick: NodeMouseHandler = (_, node) => {
    onSelectNode(node.id);
  };

  return (
    <section
      className="gc-exec-canvas"
      aria-label={t("executions.detail.canvas.aria")}
      data-testid="gc-exec-canvas"
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          fitView
          onNodeClick={handleClick}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </section>
  );
}
