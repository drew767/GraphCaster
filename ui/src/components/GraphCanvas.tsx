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
import { minimapNodeFill, minimapNodeStroke } from "../graph/minimapNodeColors";
import { flowConnectionHandle } from "../graph/normalizeHandles";
import { sanitizeGraphConnectivity } from "../graph/sanitize";
import type { GraphDocumentJson, GraphEdgeJson } from "../graph/types";
import type { GcNodeData } from "../graph/toReactFlow";
import type { AddNodeMenuPick, WorkspaceGraphAddMenuRow } from "../graph/addNodeMenu";
import { GRAPH_NODE_TYPE_START, isReactFlowFrameNodeType } from "../graph/nodeKinds";
import { newGraphEdgeId } from "../graph/nodePalette";
import {
  gcFlowEdgeDocumentPayloadEqual,
  gcFlowEdgesSyncKeepSelection,
} from "../graph/gcFlowEdgeSync";
import { graphDocumentToFlow } from "../graph/toReactFlow";
import { CanvasAddNodeMenu } from "./CanvasAddNodeMenu";
import { NodeContextMenu } from "./NodeContextMenu";
import { GcCommentNode } from "./nodes/GcCommentNode";
import { GcGroupNode } from "./nodes/GcGroupNode";
import { GcFlowNode } from "./nodes/GcFlowNode";
import {
  nodeRunOverlayMapsEqual,
  type NodeRunOverlayEntry,
  type NodeRunPhase,
} from "../run/nodeRunOverlay";

const EMPTY_WARNING_EDGE_IDS: ReadonlySet<string> = new Set();

const GC_NODE_RUN_CLASS_RE = /\bgc-node--run-(active|running|success|failed|skipped)\b/g;

const GC_EDGE_WARN_CLASS = "gc-edge--warning";

function runHighlightClassNameForNode(
  n: Node<GcNodeData>,
  nodeRunOverlayById: Readonly<Record<string, NodeRunOverlayEntry>>,
  hl: string | null,
): { className: string | undefined; effectivePhase: NodeRunPhase | null } {
  const strip = (n.className ?? "").replace(GC_NODE_RUN_CLASS_RE, "").trim();
  const phase = nodeRunOverlayById[n.id]?.phase;
  const hlHere = hl !== null && n.id === hl;
  const effectivePhase = phase ?? (hlHere ? ("running" as const) : null);
  let runClass: string | undefined;
  if (phase === "failed") {
    runClass = "gc-node--run-failed";
  } else if (phase === "skipped") {
    runClass = "gc-node--run-skipped";
  } else if (phase === "success") {
    runClass = "gc-node--run-success";
  } else if (phase === "running") {
    runClass = "gc-node--run-running";
  } else if (hlHere) {
    runClass = "gc-node--run-active";
  }
  const className = runClass != null ? (strip ? `${strip} ${runClass}` : runClass) : strip || undefined;
  return { className, effectivePhase };
}

function mergeEdgeWarningHighlight(edges: Edge[], warnIds: ReadonlySet<string>): Edge[] {
  return edges.map((e) => {
    const want = warnIds.has(e.id);
    const strip = (e.className ?? "").replace(/\bgc-edge--warning\b/g, "").trim();
    const className = want
      ? strip
        ? `${strip} ${GC_EDGE_WARN_CLASS}`
        : GC_EDGE_WARN_CLASS
      : strip || undefined;
    return { ...e, className };
  });
}

export type GraphCanvasSelection =
  | {
      kind: "node";
      id: string;
      graphNodeType: string;
      label: string;
      raw: Record<string, unknown>;
    }
  | {
      kind: "multiNode";
      ids: string[];
      nodes: { id: string; graphNodeType: string; label: string }[];
    }
  | {
      kind: "edge";
      id: string;
      source: string;
      target: string;
      condition: string | null;
      routeDescription: string;
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

export type ExportDocumentOptions = {
  /** When false, do not call onExportRemovedDanglingEdges (history / internal snapshots). Default true. */
  notifyRemovedDanglingEdges?: boolean;
};

export type GraphCanvasHandle = {
  exportDocument: (options?: ExportDocumentOptions) => GraphDocumentJson;
  focusNode: (nodeId: string) => void;
  removeNodesById: (ids: readonly string[]) => void;
};

type Props = {
  graphDocument: GraphDocumentJson;
  /** Increment when the graph is replaced (Open/New) so the viewport refits. */
  layoutEpoch: number;
  onSelect: (selection: GraphCanvasSelection | null) => void;
  /** Fires after a node drag ends (for workspace autosave). */
  onNodeDragEnd?: () => void;
  /** Snapshot document for undo before a structural remove (Delete, context menu). */
  onBeforeStructureRemove?: () => void;
  /** Remember exported document at drag start (no undo snapshot until drag end if changed). */
  onNodeDragCaptureBegin?: () => void;
  /** After positions/reparent settle; push undo snapshot if document differs from capture; then parent syncs. */
  onBeforeNodeDragStructureSync?: () => void;
  workspaceGraphsForAddMenu: ReadonlyArray<WorkspaceGraphAddMenuRow>;
  onAddNode: (pick: AddNodeMenuPick, flowPosition: { x: number; y: number }) => void;
  onConnectNewEdge: (edge: GraphEdgeJson) => void;
  onFlowStructureChange: () => void;
  /** When true: no new connections, delete, drag, or context-menu add (active Run). */
  structureLocked?: boolean;
  /** Highlights the node id from runner events (node_enter / node_execute). */
  runHighlightNodeId?: string | null;
  /** Per-node execution overlay from run-event stream (live or replay). */
  nodeRunOverlayById?: Readonly<Record<string, NodeRunOverlayEntry>>;
  /**
   * Bump-driven counter from `runSessionStore` when the visible overlay slice changes.
   * Avoids O(n) `nodeRunOverlayMapsEqual` on unrelated session emits when provided.
   */
  nodeRunOverlayRevision?: number;
  /** Called when export drops edges with missing endpoint nodes (sanitize). */
  onExportRemovedDanglingEdges?: (removedEdgeIds: string[]) => void;
  /** Edge ids with branch/handle/structure warnings — yellow stroke on canvas. */
  warningEdgeIds?: ReadonlySet<string>;
};

const nodeTypes = {
  gcNode: GcFlowNode,
  gcComment: GcCommentNode,
  gcGroup: GcGroupNode,
} as const satisfies NodeTypes;

function flowStateAfterRemovingNodeIds(
  nds: Node<GcNodeData>[],
  eds: Edge[],
  removeIds: Set<string>,
): { nodes: Node<GcNodeData>[]; edges: Edge[] } {
  const oldById = new Map(nds.map((n) => [n.id, n]));
  let next = nds.filter((n) => !removeIds.has(n.id));
  next = next.map((n) => {
    if (n.parentId && removeIds.has(n.parentId)) {
      const p = oldById.get(n.parentId);
      if (p && isReactFlowFrameNodeType(p.type)) {
        const abs = getWorldTopLeft(n as Node<GcNodeData>, oldById);
        const { parentId: _p, extent: _e, ...rest } = n as Node<GcNodeData> & {
          parentId?: string;
          extent?: unknown;
        };
        return { ...rest, position: abs } as Node<GcNodeData>;
      }
    }
    return n;
  });
  next = next.filter((n) => !removeIds.has(n.id));
  const nextEdges = eds.filter((e) => !removeIds.has(e.source) && !removeIds.has(e.target));
  return { nodes: next, edges: nextEdges };
}

type BridgeProps = {
  baseDocument: GraphDocumentJson;
  onExportRemovedDanglingEdges?: (removedEdgeIds: string[]) => void;
  removeNodesByIdRef: MutableRefObject<(ids: readonly string[]) => void>;
};

const FlowCanvasHandleBridge = forwardRef<GraphCanvasHandle, BridgeProps>(
  function FlowCanvasHandleBridge(
    { baseDocument, onExportRemovedDanglingEdges, removeNodesByIdRef },
    ref,
  ) {
    const { getNodes, getEdges, getNode, fitView } = useReactFlow();
    useImperativeHandle(
      ref,
      () => ({
        exportDocument(options?: ExportDocumentOptions) {
          const doc = flowToDocument(getNodes() as Node<GcNodeData>[], getEdges(), baseDocument);
          const { document, removedEdgeIds } = sanitizeGraphConnectivity(doc);
          const notify = options?.notifyRemovedDanglingEdges !== false;
          if (removedEdgeIds.length > 0 && notify) {
            onExportRemovedDanglingEdges?.(removedEdgeIds);
          }
          return document;
        },
        focusNode(nodeId: string) {
          const id = nodeId.trim();
          if (id === "") {
            return;
          }
          const n = getNode(id);
          if (!n) {
            return;
          }
          void fitView({
            nodes: [{ id }],
            padding: 0.28,
            duration: 220,
            minZoom: 0.12,
            maxZoom: 1.85,
          });
        },
        removeNodesById(ids: readonly string[]) {
          removeNodesByIdRef.current(ids);
        },
      }),
      [getNodes, getEdges, getNode, fitView, baseDocument, onExportRemovedDanglingEdges, removeNodesByIdRef],
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
      onBeforeStructureRemove,
      onNodeDragCaptureBegin,
      onBeforeNodeDragStructureSync,
      onAddNode,
      workspaceGraphsForAddMenu,
      onConnectNewEdge,
      onFlowStructureChange,
      structureLocked = false,
      runHighlightNodeId = null,
      nodeRunOverlayById = {},
      nodeRunOverlayRevision,
      onExportRemovedDanglingEdges,
      warningEdgeIds = EMPTY_WARNING_EDGE_IDS,
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

    const minimapNodeColor = useCallback((node: Node<GcNodeData>) => minimapNodeFill(node), []);
    const minimapNodeStrokeColor = useCallback((node: Node<GcNodeData>) => minimapNodeStroke(node), []);

    const flowFromDocument = useMemo(() => graphDocumentToFlow(graphDocument), [graphDocument]);
    const [nodes, setNodes, onNodesChange] = useNodesState(flowFromDocument.nodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(flowFromDocument.edges);
    const nodesRef = useRef(nodes);
    nodesRef.current = nodes;
    const edgesRef = useRef(edges);
    edgesRef.current = edges;
    const removeNodesByIdRef = useRef<(ids: readonly string[]) => void>(() => {});

    // Stabilize overlay map reference for effect deps when semantics are unchanged (see `useMemo` deps).
    const overlayStabRef = useRef<{
      rev: number;
      map: Readonly<Record<string, NodeRunOverlayEntry>>;
    } | null>(null);
    const nodeRunOverlayForSync = useMemo(() => {
      const overlayRev = nodeRunOverlayRevision ?? -1;
      if (overlayStabRef.current === null) {
        overlayStabRef.current = { rev: overlayRev, map: nodeRunOverlayById };
        return nodeRunOverlayById;
      }
      if (overlayRev === -1) {
        if (!nodeRunOverlayMapsEqual(overlayStabRef.current.map, nodeRunOverlayById)) {
          overlayStabRef.current = { rev: -1, map: nodeRunOverlayById };
          return nodeRunOverlayById;
        }
        return overlayStabRef.current.map;
      }
      if (overlayRev !== overlayStabRef.current.rev) {
        overlayStabRef.current = { rev: overlayRev, map: nodeRunOverlayById };
        return nodeRunOverlayById;
      }
      if (nodeRunOverlayById !== overlayStabRef.current.map) {
        if (!nodeRunOverlayMapsEqual(overlayStabRef.current.map, nodeRunOverlayById)) {
          overlayStabRef.current = { rev: overlayRev, map: nodeRunOverlayById };
          return nodeRunOverlayById;
        }
      }
      return overlayStabRef.current.map;
    }, [nodeRunOverlayRevision, nodeRunOverlayById]);

    const onNodesChangeWrapped = useCallback(
      (changes: NodeChange<Node>[]) => {
        if (structureLocked && changes.some((c) => c.type === "remove")) {
          return;
        }
        if (!structureLocked && changes.some((c) => c.type === "remove")) {
          onBeforeStructureRemove?.();
        }
        onNodesChange(changes as NodeChange<Node<GcNodeData>>[]);
        const syncDoc = changes.some((c) => c.type === "remove" || c.type === "dimensions");
        if (syncDoc) {
          window.requestAnimationFrame(() => {
            onFlowStructureChange();
          });
        }
      },
      [structureLocked, onBeforeStructureRemove, onFlowStructureChange, onNodesChange],
    );

    const onEdgesChangeWrapped = useCallback(
      (changes: EdgeChange[]) => {
        if (structureLocked && changes.some((c) => c.type === "remove")) {
          return;
        }
        if (!structureLocked && changes.some((c) => c.type === "remove")) {
          onBeforeStructureRemove?.();
        }
        onEdgesChange(changes);
        const removed = changes.some((c) => c.type === "remove");
        if (removed) {
          window.requestAnimationFrame(() => {
            onFlowStructureChange();
          });
        }
      },
      [structureLocked, onBeforeStructureRemove, onEdgesChange, onFlowStructureChange],
    );

    const onConnect = useCallback(
      (c: Connection) => {
        if (structureLocked) {
          return;
        }
        if (!c.source || !c.target || c.source === c.target) {
          return;
        }
        const src = nodes.find((n) => n.id === c.source);
        const tgt = nodes.find((n) => n.id === c.target);
        if (isReactFlowFrameNodeType(src?.type) || isReactFlowFrameNodeType(tgt?.type)) {
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
      [structureLocked, edges, nodes, onConnectNewEdge],
    );

    const onBeforeDelete = useCallback(
      async ({ nodes: pending, edges: pendingEdges }: { nodes: Node[]; edges: Edge[] }) => {
        const all = nodesRef.current;
        const removeIds = new Set(pending.map((n) => n.id));
        const filtered = pending.filter((n) => {
          const d = n.data as GcNodeData | undefined;
          if (d?.graphNodeType === GRAPH_NODE_TYPE_START) {
            return false;
          }
          if (n.parentId && removeIds.has(n.parentId)) {
            const parent = all.find((p) => p.id === n.parentId);
            if (parent && isReactFlowFrameNodeType(parent.type)) {
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
          deleted.filter((n) => isReactFlowFrameNodeType(n.type)).map((n) => n.id),
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
        if (isReactFlowFrameNodeType(node.type)) {
          window.requestAnimationFrame(() => {
            onBeforeNodeDragStructureSync?.();
            onFlowStructureChange();
            onNodeDragEnd?.();
          });
          return;
        }
        setNodes((nds) => reparentDraggedNode(nds as Node<GcNodeData>[], node.id));
        window.requestAnimationFrame(() => {
          onBeforeNodeDragStructureSync?.();
          onFlowStructureChange();
          onNodeDragEnd?.();
        });
      },
      [onBeforeNodeDragStructureSync, onFlowStructureChange, onNodeDragEnd, setNodes],
    );

    const onNodeDragStartWrapped = useCallback(() => {
      onNodeDragCaptureBegin?.();
    }, [onNodeDragCaptureBegin]);

    useEffect(() => {
      const base = flowFromDocument;
      const hl = runHighlightNodeId != null && runHighlightNodeId.trim() !== "" ? runHighlightNodeId.trim() : null;

      setNodes((prev) => {
        const prevById = new Map(prev.map((x) => [x.id, x]));
        const orderMatches =
          prev.length === base.nodes.length && base.nodes.every((n, i) => n.id === prev[i]?.id);

        if (!orderMatches) {
          return base.nodes.map((n) => {
            const d = n.data as GcNodeData;
            const { className, effectivePhase } = runHighlightClassNameForNode(
              n as Node<GcNodeData>,
              nodeRunOverlayForSync,
              hl,
            );
            return {
              ...n,
              className,
              data: { ...d, runOverlayPhase: effectivePhase },
            };
          });
        }

        let changed = false;
        const out = base.nodes.map((n) => {
          const d = n.data as GcNodeData;
          const cur = prevById.get(n.id);
          const { className, effectivePhase } = runHighlightClassNameForNode(
            n as Node<GcNodeData>,
            nodeRunOverlayForSync,
            hl,
          );
          if (
            cur &&
            cur.position.x === n.position.x &&
            cur.position.y === n.position.y &&
            cur.parentId === n.parentId &&
            cur.type === n.type &&
            (cur.data as GcNodeData).graphNodeType === d.graphNodeType &&
            (cur.data as GcNodeData).label === d.label &&
            (cur.data as GcNodeData).raw === d.raw
          ) {
            const cd = cur.data as GcNodeData;
            if (cur.className === className && cd.runOverlayPhase === effectivePhase) {
              return cur;
            }
            changed = true;
            return {
              ...cur,
              className,
              data: { ...cd, runOverlayPhase: effectivePhase },
            };
          }
          changed = true;
          return {
            ...n,
            className,
            data: { ...d, runOverlayPhase: effectivePhase },
          };
        });
        return changed ? out : prev;
      });

      setEdges((prev) => {
        const next = mergeEdgeWarningHighlight(base.edges, warningEdgeIds);
        if (prev.length !== next.length) {
          return next;
        }
        const nextById = new Map(next.map((e) => [e.id, e]));
        if (prev.some((e) => !nextById.has(e.id))) {
          return next;
        }
        let same = true;
        for (const a of prev) {
          const b = nextById.get(a.id)!;
          if (a.className !== b.className || !gcFlowEdgeDocumentPayloadEqual(a, b)) {
            same = false;
            break;
          }
        }
        return same ? prev : gcFlowEdgesSyncKeepSelection(prev, next);
      });
    }, [
      flowFromDocument,
      runHighlightNodeId,
      nodeRunOverlayForSync,
      nodeRunOverlayRevision,
      warningEdgeIds,
      setNodes,
      setEdges,
    ]);

    const onSelectionChange = useCallback(
      ({ nodes: selNodes, edges: selEdges }: { nodes: Node[]; edges: Edge[] }) => {
        if (selNodes.length >= 2) {
          const rows = selNodes.map((node) => {
            const d = node.data as GcNodeData | undefined;
            return {
              id: node.id,
              graphNodeType: d?.graphNodeType ?? "unknown",
              label: d?.label ?? node.id,
            };
          });
          onSelect({ kind: "multiNode", ids: rows.map((r) => r.id), nodes: rows });
          return;
        }
        if (selNodes.length === 1) {
          const node = selNodes[0];
          const d = node.data as GcNodeData | undefined;
          if (!d) {
            onSelect(null);
            return;
          }
          onSelect({
            kind: "node",
            id: node.id,
            graphNodeType: d.graphNodeType,
            label: d.label,
            raw: d.raw,
          });
          return;
        }
        if (selEdges.length >= 1) {
          const edge = selEdges[0];
          const ed = edge.data as { routeDescription?: string } | undefined;
          const rd = typeof ed?.routeDescription === "string" ? ed.routeDescription : "";
          onSelect({
            kind: "edge",
            id: edge.id,
            source: edge.source,
            target: edge.target,
            condition: conditionFromEdgeLabel(edge.label),
            routeDescription: rd,
          });
          return;
        }
        onSelect(null);
      },
      [onSelect],
    );

    const applyRemoveNodeIds = useCallback(
      (rawIds: readonly string[]) => {
        if (structureLocked) {
          return;
        }
        const removeIds = new Set<string>();
        for (const id of rawIds) {
          const t = String(id).trim();
          if (t === "") {
            continue;
          }
          const node = nodesRef.current.find((n) => n.id === t);
          const d = node?.data as GcNodeData | undefined;
          if (d?.graphNodeType === GRAPH_NODE_TYPE_START) {
            continue;
          }
          removeIds.add(t);
        }
        if (removeIds.size === 0) {
          return;
        }
        onBeforeStructureRemove?.();
        const { nodes: nn, edges: ne } = flowStateAfterRemovingNodeIds(
          nodesRef.current as Node<GcNodeData>[],
          edgesRef.current,
          removeIds,
        );
        setNodes(nn);
        setEdges(ne);
        onSelect(null);
        window.requestAnimationFrame(() => {
          onFlowStructureChange();
        });
      },
      [structureLocked, onBeforeStructureRemove, onFlowStructureChange, onSelect, setNodes, setEdges],
    );

    removeNodesByIdRef.current = applyRemoveNodeIds;

    const onPaneClick = useCallback(() => {
      setAddMenu(null);
      setNodeCtxMenu(null);
      onSelect(null);
    }, [onSelect]);

    const onPaneContextMenu = useCallback(
      (e: { preventDefault: () => void; clientX: number; clientY: number }) => {
        if (structureLocked) {
          return;
        }
        e.preventDefault();
        setNodeCtxMenu(null);
        const project = projectScreenToFlowRef.current;
        if (!project) {
          return;
        }
        const flow = project(e.clientX, e.clientY);
        setAddMenu({ sx: e.clientX, sy: e.clientY, fx: flow.x, fy: flow.y });
      },
      [structureLocked],
    );

    const onNodeContextMenu = useCallback(
      (e: MouseEvent, node: Node) => {
        if (structureLocked) {
          return;
        }
        e.preventDefault();
        setAddMenu(null);
        setNodeCtxMenu({ sx: e.clientX, sy: e.clientY, nodeId: node.id });
      },
      [structureLocked],
    );

    const onDeleteNodeFromMenu = useCallback(
      (nodeId: string) => {
        applyRemoveNodeIds([nodeId]);
      },
      [applyRemoveNodeIds],
    );

    return (
      <div className="gc-flow-wrap">
        <ReactFlow
          colorMode="system"
          ariaLabelConfig={flowAriaLabels}
          onlyRenderVisibleElements
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChangeWrapped}
          onEdgesChange={onEdgesChangeWrapped}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          selectionOnDrag
          panOnDrag={[1, 2]}
          multiSelectionKeyCode="Shift"
          onSelectionChange={onSelectionChange}
          onPaneClick={onPaneClick}
          onPaneContextMenu={onPaneContextMenu}
          onNodeContextMenu={onNodeContextMenu}
          onNodeDragStart={onNodeDragStartWrapped}
          onNodeDragStop={onNodeDragStopWrapped}
          onBeforeDelete={onBeforeDelete}
          onNodesDelete={onNodesDelete}
          nodesConnectable={!structureLocked}
          nodesDraggable={!structureLocked}
          elementsSelectable={!structureLocked}
          deleteKeyCode={structureLocked ? null : ["Delete", "Backspace"]}
        >
          <FlowProjectionBridge projectRef={projectScreenToFlowRef} />
          <RefitOnLayoutEpoch epoch={layoutEpoch} />
          <FlowCanvasHandleBridge
            ref={ref}
            baseDocument={graphDocument}
            onExportRemovedDanglingEdges={onExportRemovedDanglingEdges}
            removeNodesByIdRef={removeNodesByIdRef}
          />
          <Background gap={16} size={1} />
          <Controls />
          <MiniMap
            pannable
            zoomable
            nodeColor={minimapNodeColor}
            nodeStrokeColor={minimapNodeStrokeColor}
          />
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
