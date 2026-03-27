// Copyright GraphCaster. All Rights Reserved.

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
import { useTranslation } from "react-i18next";
import "@xyflow/react/dist/style.css";

import { flowToDocument } from "../graph/fromReactFlow";
import { getWorldTopLeft, reparentDraggedNode } from "../graph/flowHierarchy";
import { flowConnectionHandle } from "../graph/normalizeHandles";
import { sanitizeGraphConnectivity } from "../graph/sanitize";
import type { GraphDocumentJson, GraphEdgeJson } from "../graph/types";
import type { GcNodeData } from "../graph/toReactFlow";
import type { AddNodeMenuPick, WorkspaceGraphAddMenuRow } from "../graph/addNodeMenu";
import { newGraphEdgeId } from "../graph/nodePalette";
import { graphDocumentToFlow } from "../graph/toReactFlow";
import { CanvasAddNodeMenu } from "./CanvasAddNodeMenu";
import { NodeContextMenu } from "./NodeContextMenu";
import { GcCommentNode } from "./nodes/GcCommentNode";
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
  workspaceGraphsForAddMenu: ReadonlyArray<WorkspaceGraphAddMenuRow>;
  onAddNode: (pick: AddNodeMenuPick, flowPosition: { x: number; y: number }) => void;
  onConnectNewEdge: (edge: GraphEdgeJson) => void;
  onFlowStructureChange: () => void;
};

const nodeTypes = {
  gcNode: GcFlowNode,
  gcComment: GcCommentNode,
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
      workspaceGraphsForAddMenu,
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
    const [nodeCtxMenu, setNodeCtxMenu] = useState<{ sx: number; sy: number; nodeId: string } | null>(null);
    const hasStartNode = useMemo(
      () => (graphDocument.nodes ?? []).some((n) => n.type === "start"),
      [graphDocument],
    );

    const { t, i18n } = useTranslation();
    const flowAriaLabels = useMemo(
      () => ({
        "controls.ariaLabel": t("app.canvas.flowControls.panel"),
        "controls.zoomIn.ariaLabel": t("app.canvas.flowControls.zoomIn"),
        "controls.zoomOut.ariaLabel": t("app.canvas.flowControls.zoomOut"),
        "controls.fitView.ariaLabel": t("app.canvas.flowControls.fitView"),
        "controls.interactive.ariaLabel": t("app.canvas.flowControls.interactivity"),
      }),
      [t, i18n.language],
    );

    const initial = useMemo(() => graphDocumentToFlow(graphDocument), [graphDocument]);
    const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
    const nodesRef = useRef(nodes);
    nodesRef.current = nodes;

    const onNodesChangeWrapped = useCallback(
      (changes: NodeChange<Node>[]) => {
        onNodesChange(changes as NodeChange<Node<GcNodeData>>[]);
        const syncDoc = changes.some((c) => c.type === "remove" || c.type === "dimensions");
        if (syncDoc) {
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
        const src = nodes.find((n) => n.id === c.source);
        const tgt = nodes.find((n) => n.id === c.target);
        if (src?.type === "gcComment" || tgt?.type === "gcComment") {
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
      [edges, nodes, onConnectNewEdge],
    );

    const onBeforeDelete = useCallback(
      async ({ nodes: pending, edges: pendingEdges }: { nodes: Node[]; edges: Edge[] }) => {
        const all = nodesRef.current;
        const removeIds = new Set(pending.map((n) => n.id));
        const filtered = pending.filter((n) => {
          if (n.parentId && removeIds.has(n.parentId)) {
            const parent = all.find((p) => p.id === n.parentId);
            if (parent?.type === "gcComment") {
              return false;
            }
          }
          return true;
        });
        return { nodes: filtered, edges: pendingEdges };
      },
      [],
    );

    const onNodesDelete = useCallback(
      (deleted: Node[]) => {
        const deadCommentIds = new Set(
          deleted.filter((n) => n.type === "gcComment").map((n) => n.id),
        );
        if (deadCommentIds.size === 0) {
          return;
        }
        setNodes((nds) => {
          const byId = new Map(nds.map((n) => [n.id, n]));
          return nds.map((n) => {
            if (!n.parentId || !deadCommentIds.has(n.parentId)) {
              return n;
            }
            const abs = getWorldTopLeft(n, byId);
            const { parentId: _p, extent: _e, ...rest } = n;
            return { ...rest, position: abs } as Node<GcNodeData>;
          });
        });
      },
      [setNodes],
    );

    const onNodeDragStopWrapped = useCallback(
      (_e: unknown, node: Node) => {
        if (node.type === "gcComment") {
          onNodeDragEnd?.();
          return;
        }
        setNodes((nds) => reparentDraggedNode(nds as Node<GcNodeData>[], node.id));
        window.requestAnimationFrame(() => {
          onFlowStructureChange();
          onNodeDragEnd?.();
        });
      },
      [onFlowStructureChange, onNodeDragEnd, setNodes],
    );

    useEffect(() => {
      const next = graphDocumentToFlow(graphDocument);
      setNodes(next.nodes);
      setEdges(next.edges);
    }, [graphDocument, setNodes, setEdges]);

    const onNodeClick = useCallback(
      (_event: MouseEvent, node: Node) => {
        const d = node.data as GcNodeData | undefined;
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
      setNodeCtxMenu(null);
      onSelect(null);
    }, [onSelect]);

    const onPaneContextMenu = useCallback(
      (e: { preventDefault: () => void; clientX: number; clientY: number }) => {
        e.preventDefault();
        setNodeCtxMenu(null);
        const project = projectScreenToFlowRef.current;
        if (!project) {
          return;
        }
        const flow = project(e.clientX, e.clientY);
        setAddMenu({ sx: e.clientX, sy: e.clientY, fx: flow.x, fy: flow.y });
      },
      [],
    );

    const onNodeContextMenu = useCallback((e: MouseEvent, node: Node) => {
      e.preventDefault();
      setAddMenu(null);
      setNodeCtxMenu({ sx: e.clientX, sy: e.clientY, nodeId: node.id });
    }, []);

    const onDeleteNodeFromMenu = useCallback(
      (nodeId: string) => {
        setNodes((nds) => {
          const target = nds.find((n) => n.id === nodeId);
          const byId = new Map(nds.map((n) => [n.id, n]));
          const rest = nds.filter((n) => n.id !== nodeId);
          if (target?.type === "gcComment") {
            return rest.map((n) => {
              if (n.parentId !== nodeId) {
                return n;
              }
              const abs = getWorldTopLeft(n, byId);
              const { parentId: _p, extent: _e, ...stripped } = n as Node<GcNodeData> & {
                parentId?: string;
                extent?: unknown;
              };
              return { ...stripped, position: abs } as Node<GcNodeData>;
            });
          }
          return rest;
        });
        setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
        onSelect(null);
        window.requestAnimationFrame(() => {
          onFlowStructureChange();
        });
      },
      [onFlowStructureChange, onSelect, setEdges, setNodes],
    );

    return (
      <div className="gc-flow-wrap">
        <ReactFlow
          colorMode="system"
          ariaLabelConfig={flowAriaLabels}
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
          onNodeContextMenu={onNodeContextMenu}
          onNodeDragStop={onNodeDragStopWrapped}
          onBeforeDelete={onBeforeDelete}
          onNodesDelete={onNodesDelete}
          nodesConnectable
          nodesDraggable
          elementsSelectable
          deleteKeyCode={["Delete", "Backspace"]}
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
          workspaceGraphs={workspaceGraphsForAddMenu}
          onClose={() => {
            setAddMenu(null);
          }}
          onPick={(pick, flowPosition) => {
            onAddNode(pick, flowPosition);
          }}
        />
        <NodeContextMenu
          open={nodeCtxMenu != null}
          screenPos={
            nodeCtxMenu != null ? { x: nodeCtxMenu.sx, y: nodeCtxMenu.sy } : { x: 0, y: 0 }
          }
          nodeId={nodeCtxMenu?.nodeId ?? ""}
          onClose={() => {
            setNodeCtxMenu(null);
          }}
          onDelete={() => {
            if (nodeCtxMenu != null) {
              onDeleteNodeFromMenu(nodeCtxMenu.nodeId);
            }
            setNodeCtxMenu(null);
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
