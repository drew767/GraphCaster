// Copyright Aura. All Rights Reserved.

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeTypes,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { MouseEvent } from "react";
import "@xyflow/react/dist/style.css";

import { flowToDocument } from "../graph/fromReactFlow";
import { flowConnectionHandle } from "../graph/normalizeHandles";
import { sanitizeGraphConnectivity } from "../graph/sanitize";
import type { GraphDocumentJson, GraphEdgeJson } from "../graph/types";
import type { GcNodeData } from "../graph/toReactFlow";
import type { PaletteNodeType } from "../graph/nodePalette";
import { newGraphEdgeId } from "../graph/nodePalette";
import { graphDocumentToFlow } from "../graph/toReactFlow";
import { CanvasAddNodeMenu } from "./CanvasAddNodeMenu";
import { GcFlowNode } from "./nodes/GcFlowNode";

export type GraphCanvasSelection =
  | {
      kind: "node";
      id: string;
      graphNodeType: string;
      label: string;
      raw: Record<string, unknown>;
    }
  | {
      kind: "edge";
      id: string;
      source: string;
      target: string;
      condition: string | null;
    };

/** @deprecated Prefer `GraphCanvasSelection` with `kind: "node"`. */
export type GraphNodeSelection = Extract<GraphCanvasSelection, { kind: "node" }>;

function conditionFromEdgeLabel(label: Edge["label"]): string | null {
  if (label == null) {
    return null;
  }
  if (typeof label === "string") {
    const s = label.trim();
    return s === "" ? null : s;
  }
  return null;
}

export type GraphCanvasHandle = {
  exportDocument: () => GraphDocumentJson;
};

type Props = {
  graphDocument: GraphDocumentJson;
  /** Increment when the graph is replaced (Open/New) so the viewport refits. */
  layoutEpoch: number;
  onSelect: (selection: GraphCanvasSelection | null) => void;
  /** Fires after a node drag ends (for workspace autosave). */
  onNodeDragEnd?: () => void;
  onAddNode: (nodeType: PaletteNodeType, flowPosition: { x: number; y: number }) => void;
  onConnectNewEdge: (edge: GraphEdgeJson) => void;
  onFlowStructureChange: () => void;
};

const nodeTypes = {
  gcNode: GcFlowNode,
} as const satisfies NodeTypes;

type BridgeProps = {
  baseDocument: GraphDocumentJson;
};

const FlowExportBridge = forwardRef<GraphCanvasHandle, BridgeProps>(
  function FlowExportBridge({ baseDocument }, ref) {
    const { getNodes, getEdges } = useReactFlow();
    useImperativeHandle(
      ref,
      () => ({
        exportDocument() {
          const doc = flowToDocument(getNodes() as Node<GcNodeData>[], getEdges(), baseDocument);
          return sanitizeGraphConnectivity(doc);
        },
      }),
      [getNodes, getEdges, baseDocument],
    );
    return null;
  },
);

function FlowProjectionBridge({
  projectRef,
}: {
  projectRef: MutableRefObject<((clientX: number, clientY: number) => { x: number; y: number }) | null>;
}) {
  const rf = useReactFlow();
  useLayoutEffect(() => {
    projectRef.current = (clientX, clientY) => rf.screenToFlowPosition({ x: clientX, y: clientY });
    return () => {
      projectRef.current = null;
    };
  }, [rf, projectRef]);
  return null;
}

function RefitOnLayoutEpoch({ epoch }: { epoch: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (epoch <= 0) {
      return;
    }
    const handle = requestAnimationFrame(() => {
      void fitView({ padding: 0.15, duration: 200 });
    });
    return () => {
      cancelAnimationFrame(handle);
    };
  }, [epoch, fitView]);
  return null;
}

const GraphCanvasInner = forwardRef<GraphCanvasHandle, Props>(
  function GraphCanvasInner(
    {
      graphDocument,
      layoutEpoch,
      onSelect,
      onNodeDragEnd,
      onAddNode,
      onConnectNewEdge,
      onFlowStructureChange,
    },
    ref,
  ) {
    const projectScreenToFlowRef = useRef<
      ((clientX: number, clientY: number) => { x: number; y: number }) | null
    >(null);
    const [addMenu, setAddMenu] = useState<{
      sx: number;
      sy: number;
      fx: number;
      fy: number;
    } | null>(null);
    const hasStartNode = useMemo(
      () => (graphDocument.nodes ?? []).some((n) => n.type === "start"),
      [graphDocument],
    );

    const initial = useMemo(() => graphDocumentToFlow(graphDocument), [graphDocument]);
    const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);

    const onNodesChangeWrapped = useCallback(
      (changes: NodeChange<Node<GcNodeData>>[]) => {
        onNodesChange(changes);
        const removed = changes.some((c) => c.type === "remove");
        if (removed) {
          window.requestAnimationFrame(() => {
            onFlowStructureChange();
          });
        }
      },
      [onFlowStructureChange, onNodesChange],
    );

    const onEdgesChangeWrapped = useCallback(
      (changes: EdgeChange[]) => {
        onEdgesChange(changes);
        const removed = changes.some((c) => c.type === "remove");
        if (removed) {
          window.requestAnimationFrame(() => {
            onFlowStructureChange();
          });
        }
      },
      [onEdgesChange, onFlowStructureChange],
    );

    const onConnect = useCallback(
      (c: Connection) => {
        if (!c.source || !c.target || c.source === c.target) {
          return;
        }
        const sh = flowConnectionHandle(c.sourceHandle, "out_default");
        const th = flowConnectionHandle(c.targetHandle, "in_default");
        if (
          edges.some(
            (e) =>
              e.source === c.source &&
              e.target === c.target &&
              flowConnectionHandle(e.sourceHandle, "out_default") === sh &&
              flowConnectionHandle(e.targetHandle, "in_default") === th,
          )
        ) {
          return;
        }
        onConnectNewEdge({
          id: newGraphEdgeId(),
          source: c.source,
          target: c.target,
          sourceHandle: sh,
          targetHandle: th,
          condition: null,
        });
      },
      [edges, onConnectNewEdge],
    );

    useEffect(() => {
      const next = graphDocumentToFlow(graphDocument);
      setNodes(next.nodes);
      setEdges(next.edges);
    }, [graphDocument, setNodes, setEdges]);

    const onNodeClick = useCallback(
      (_event: MouseEvent, node: Node<GcNodeData>) => {
        const d = node.data;
        if (!d) {
          return;
        }
        onSelect({
          kind: "node",
          id: node.id,
          graphNodeType: d.graphNodeType,
          label: d.label,
          raw: d.raw,
        });
      },
      [onSelect],
    );

    const onEdgeClick = useCallback(
      (_event: MouseEvent, edge: Edge) => {
        onSelect({
          kind: "edge",
          id: edge.id,
          source: edge.source,
          target: edge.target,
          condition: conditionFromEdgeLabel(edge.label),
        });
      },
      [onSelect],
    );

    const onPaneClick = useCallback(() => {
      setAddMenu(null);
      onSelect(null);
    }, [onSelect]);

    const onPaneContextMenu = useCallback(
      (e: { preventDefault: () => void; clientX: number; clientY: number }) => {
        e.preventDefault();
        const project = projectScreenToFlowRef.current;
        if (!project) {
          return;
        }
        const flow = project(e.clientX, e.clientY);
        setAddMenu({ sx: e.clientX, sy: e.clientY, fx: flow.x, fy: flow.y });
      },
      [],
    );

    return (
      <div className="gc-flow-wrap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChangeWrapped}
          onEdgesChange={onEdgesChangeWrapped}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          onPaneContextMenu={onPaneContextMenu}
          onNodeDragStop={onNodeDragEnd}
          nodesConnectable
          nodesDraggable
          elementsSelectable
        >
          <FlowProjectionBridge projectRef={projectScreenToFlowRef} />
          <RefitOnLayoutEpoch epoch={layoutEpoch} />
          <FlowExportBridge ref={ref} baseDocument={graphDocument} />
          <Background gap={16} size={1} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
        <CanvasAddNodeMenu
          open={addMenu != null}
          screenPos={addMenu != null ? { x: addMenu.sx, y: addMenu.sy } : { x: 0, y: 0 }}
          flowPos={addMenu != null ? { x: addMenu.fx, y: addMenu.fy } : { x: 0, y: 0 }}
          hasStartNode={hasStartNode}
          onClose={() => {
            setAddMenu(null);
          }}
          onPick={(ty, flowPosition) => {
            onAddNode(ty, flowPosition);
          }}
        />
      </div>
    );
  },
);

export const GraphCanvas = forwardRef<GraphCanvasHandle, Props>(function GraphCanvas(
  props,
  ref,
) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner ref={ref} {...props} />
    </ReactFlowProvider>
  );
});
