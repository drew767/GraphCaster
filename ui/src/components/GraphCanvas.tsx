// Copyright GraphCaster. All Rights Reserved.

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import "@xyflow/react/dist/style.css";

import { effectiveRunEdgeAnimated, effectiveRunNodePulse, type RunMotionPreference } from "../graph/canvasRunMotion";
import { usePrefersColorSchemeDark } from "../lib/usePrefersColorSchemeDark";
import { usePrefersReducedMotion } from "../lib/usePrefersReducedMotion";
import {
  connectionLineStyleForTheme,
  GC_CONNECTION_RADIUS,
  gcConnectionLineType,
} from "../graph/canvasConnectionUi";
import { CANVAS_GRID_STEP } from "../graph/canvasSnapGrid";
import { getWorldTopLeft, reparentDraggedNode } from "../graph/flowHierarchy";
import type { MinimapChrome } from "../graph/minimapChrome";
import { minimapChromeForTheme } from "../graph/minimapChrome";
import { minimapNodeFill, minimapNodeStroke } from "../graph/minimapNodeColors";
import type { GraphDocumentJson, GraphEdgeJson } from "../graph/types";
import type { GcNodeData } from "../graph/toReactFlow";
import {
  buildAddNodeConnectMenuFilter,
  type AddNodeMenuPick,
  type WorkspaceGraphAddMenuRow,
} from "../graph/addNodeMenu";
import {
  GC_DRAG_NODE_MIME_TYPE,
  decodeNodeDragData,
  isGcNodeDragEvent,
} from "../graph/nodeDragDrop";
import { GRAPH_NODE_TYPE_START, isReactFlowFrameNodeType } from "../graph/nodeKinds";
import { graphDocumentToFlow } from "../graph/toReactFlow";
import {
  FlowCanvasHandleBridge,
  FlowProjectionBridge,
  FollowActiveRunCamera,
  RefitOnLayoutEpoch,
} from "./canvas/GraphCanvasFlowBridges";
import { flowStateAfterRemovingNodeIds } from "./canvas/graphCanvasFlowRemove";
import type { GraphCanvasHandle } from "./canvas/graphCanvasHandleTypes";

export type { ExportDocumentOptions, GraphCanvasHandle } from "./canvas/graphCanvasHandleTypes";
import {
  type GcConnectDroppedOnPaneArgs,
  useGraphCanvasConnections,
} from "./canvas/hooks/useGraphCanvasConnections";
import { useGraphCanvasDocumentRunOverlaySync } from "./canvas/hooks/useGraphCanvasDocumentRunOverlaySync";
import { useGraphCanvasNodesEdgesChangeGuards } from "./canvas/hooks/useGraphCanvasNodesEdgesChangeGuards";
import { useGraphCanvasSelectionChange } from "./canvas/hooks/useGraphCanvasSelectionChange";
import { useGraphCanvasViewportLod } from "./canvas/hooks/useGraphCanvasViewportLod";
import type { GraphCanvasSelection, GraphNodeSelection } from "./canvas/graphCanvasSelection";
import { CanvasAddNodeMenu } from "./CanvasAddNodeMenu";
import { GcConnectionDragContext, type GcConnectionDragOrigin } from "./GcConnectionDragContext";
import { GcCanvasLodProvider } from "./GcCanvasLodContext";
import { GcViewportTierProvider } from "./GcViewportTierContext";
import { isTextEditingTarget } from "../lib/isTextEditingTarget";
import { NodeContextMenu } from "./NodeContextMenu";
import { GcBranchEdge } from "./edges/GcBranchEdge";
import { GcBranchEdgeUiContext } from "./edges/GcBranchEdgeUiContext";
import { GcCommentNode } from "./nodes/GcCommentNode";
import { GcGroupNode } from "./nodes/GcGroupNode";
import { GcFlowNode } from "./nodes/GcFlowNode";
import { nodeRunOverlayMapsEqual, type NodeRunOverlayEntry } from "../run/nodeRunOverlay";

const EMPTY_WARNING_EDGE_IDS: ReadonlySet<string> = new Set();

type GraphCanvasPaneToolsProps = {
  flowWrapRef: RefObject<HTMLDivElement | null>;
  structureLocked: boolean;
  onOpenAddMenuAt: (sx: number, sy: number, fx: number, fy: number) => void;
  minimapChrome: MinimapChrome;
  minimapNodeColor: (node: Node<GcNodeData>) => string;
  minimapNodeStrokeColor: (node: Node<GcNodeData>) => string;
};

function GraphCanvasPaneTools({
  flowWrapRef,
  structureLocked,
  onOpenAddMenuAt,
  minimapChrome,
  minimapNodeColor,
  minimapNodeStrokeColor,
}: GraphCanvasPaneToolsProps) {
  const { screenToFlowPosition, setCenter, getZoom } = useReactFlow();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (structureLocked) {
        return;
      }
      if (isTextEditingTarget(e.target)) {
        return;
      }
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
        return;
      }
      if (e.key !== "a" && e.key !== "A") {
        return;
      }
      e.preventDefault();
      const el = flowWrapRef.current;
      if (!el) {
        return;
      }
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const flow = screenToFlowPosition({ x: cx, y: cy });
      onOpenAddMenuAt(cx, cy, flow.x, flow.y);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [flowWrapRef, onOpenAddMenuAt, screenToFlowPosition, structureLocked]);

  return (
    <MiniMap
      pannable
      zoomable
      bgColor={minimapChrome.bgColor}
      maskColor={minimapChrome.maskColor}
      maskStrokeColor={minimapChrome.maskStrokeColor}
      maskStrokeWidth={minimapChrome.maskStrokeWidth}
      nodeColor={minimapNodeColor}
      nodeStrokeColor={minimapNodeStrokeColor}
      onClick={(_, pos) => {
        setCenter(pos.x, pos.y, { zoom: getZoom(), duration: 200 });
      }}
    />
  );
}

export type { GraphCanvasSelection, GraphNodeSelection };

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
  onAddNode: (
    pick: AddNodeMenuPick,
    flowPosition: { x: number; y: number },
    connectFrom?: { sourceNodeId: string; sourceHandle: string },
  ) => void;
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
  /** When true, node drag positions snap to the canvas grid (`CANVAS_GRID_STEP`). */
  snapToGridEnabled?: boolean;
  /**
   * When true, nodes fully outside the viewport (+ padding) use minimal «ghost» chrome (optional F1 profile).
   * Default false — zoom LOD unchanged for existing layouts.
   */
  ghostOffViewportEnabled?: boolean;
  /** Last traversed edge during run / replay (`edge_traverse` / `branch_taken`). */
  highlightedRunEdgeId?: string | null;
  /** Bump when run edge highlight changes (from `runSessionStore`). */
  edgeRunOverlayRevision?: number;
  /** Run visualization: full (pulse + animated edge), minimal (edge only), off (static). */
  runMotionPreference?: RunMotionPreference;
  /** Show branch / `ai_route` captions on edges (hidden when LOD is compact). Default true. */
  edgeLabelsEnabled?: boolean;
  /** User toggle: pan viewport to the active run node while a live or replay session warrants it. */
  followRunCameraEnabled?: boolean;
  /** True while replay is active or the focused run is a live run — pairs with `followRunCameraEnabled`. */
  followRunCameraActive?: boolean;
};

const nodeTypes = {
  gcNode: GcFlowNode,
  gcComment: GcCommentNode,
  gcGroup: GcGroupNode,
} as const satisfies NodeTypes;

const gcEdgeTypes = {
  gcBranch: GcBranchEdge,
} as const satisfies EdgeTypes;

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
      snapToGridEnabled = false,
      ghostOffViewportEnabled = false,
      highlightedRunEdgeId = null,
      edgeRunOverlayRevision = 0,
      runMotionPreference = "full",
      edgeLabelsEnabled = true,
      followRunCameraEnabled = false,
      followRunCameraActive = false,
    },
    ref,
  ) {
    const projectScreenToFlowRef = useRef<
      ((clientX: number, clientY: number) => { x: number; y: number }) | null
    >(null);
    const flowWrapRef = useRef<HTMLDivElement | null>(null);
    const [addMenu, setAddMenu] = useState<{
      sx: number;
      sy: number;
      fx: number;
      fy: number;
      connectFrom?: { sourceNodeId: string; sourceHandle: string };
    } | null>(null);
    const [nodeCtxMenu, setNodeCtxMenu] = useState<{ sx: number; sy: number; nodeId: string } | null>(null);
    const [connectionDrag, setConnectionDrag] = useState<GcConnectionDragOrigin>(null);
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

    const flowFromDocument = useMemo(() => graphDocumentToFlow(graphDocument), [graphDocument]);
    const [nodes, setNodes, onNodesChange] = useNodesState(flowFromDocument.nodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(flowFromDocument.edges);
    const nodesRef = useRef(nodes);
    nodesRef.current = nodes;
    const edgesRef = useRef(edges);
    edgesRef.current = edges;
    const removeNodesByIdRef = useRef<(ids: readonly string[]) => void>(() => {});

    const { canvasLod, branchEdgeUiValue, viewportTierValue } = useGraphCanvasViewportLod(
      nodes,
      ghostOffViewportEnabled,
      edgeLabelsEnabled,
    );

    const minimapNodeColor = useCallback((node: Node<GcNodeData>) => minimapNodeFill(node), []);
    const minimapNodeStrokeColor = useCallback((node: Node<GcNodeData>) => minimapNodeStroke(node), []);
    const prefersColorSchemeDark = usePrefersColorSchemeDark();
    const minimapChrome = useMemo(
      () => minimapChromeForTheme(prefersColorSchemeDark),
      [prefersColorSchemeDark],
    );
    const connectionLineStyle = useMemo(
      () => connectionLineStyleForTheme(prefersColorSchemeDark),
      [prefersColorSchemeDark],
    );

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

    const { onNodesChangeWrapped, onEdgesChangeWrapped } = useGraphCanvasNodesEdgesChangeGuards({
      structureLocked,
      onBeforeStructureRemove,
      onFlowStructureChange,
      onNodesChange,
      onEdgesChange,
    });

    const onConnectDroppedOnPane = useCallback((args: GcConnectDroppedOnPaneArgs) => {
      setNodeCtxMenu(null);
      const project = projectScreenToFlowRef.current;
      if (!project) {
        return;
      }
      const flow = project(args.screenX, args.screenY);
      setAddMenu({
        sx: args.screenX,
        sy: args.screenY,
        fx: flow.x,
        fy: flow.y,
        connectFrom: { sourceNodeId: args.sourceNodeId, sourceHandle: args.sourceHandle },
      });
    }, []);

    const { onConnectStart, onConnectEnd, isValidConnection, onConnect } = useGraphCanvasConnections({
      structureLocked,
      nodes,
      edges,
      onConnectNewEdge,
      setConnectionDrag,
      onConnectDroppedOnPane,
    });

    const addMenuConnectFilter = useMemo(() => {
      if (!addMenu?.connectFrom) {
        return null;
      }
      const src = nodes.find((n) => n.id === addMenu.connectFrom!.sourceNodeId);
      const srcType = (src?.data as GcNodeData | undefined)?.graphNodeType ?? "unknown";
      return buildAddNodeConnectMenuFilter(srcType, addMenu.connectFrom.sourceHandle);
    }, [addMenu, nodes]);

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

    const prefersReducedMotion = usePrefersReducedMotion();
    const runMotionPulseEnabled = effectiveRunNodePulse(runMotionPreference, prefersReducedMotion);
    const runEdgeAnimated = effectiveRunEdgeAnimated(runMotionPreference, prefersReducedMotion);

    useGraphCanvasDocumentRunOverlaySync({
      flowFromDocument,
      runHighlightNodeId,
      nodeRunOverlayForSync,
      nodeRunOverlayRevision,
      warningEdgeIds,
      highlightedRunEdgeId,
      edgeRunOverlayRevision,
      runMotionPulseEnabled,
      runEdgeAnimated,
      setNodes,
      setEdges,
    });

    const onSelectionChange = useGraphCanvasSelectionChange(onSelect);

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

    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const dragEnterCounterRef = useRef(0);

    const onDragEnter = useCallback(
      (e: React.DragEvent<HTMLDivElement>) => {
        if (structureLocked) {
          return;
        }
        if (isGcNodeDragEvent(e.nativeEvent)) {
          dragEnterCounterRef.current += 1;
          if (dragEnterCounterRef.current === 1) {
            setIsDraggingOver(true);
          }
        }
      },
      [structureLocked],
    );

    const onDragLeave = useCallback(
      (e: React.DragEvent<HTMLDivElement>) => {
        if (structureLocked) {
          return;
        }
        if (isGcNodeDragEvent(e.nativeEvent)) {
          dragEnterCounterRef.current -= 1;
          if (dragEnterCounterRef.current <= 0) {
            dragEnterCounterRef.current = 0;
            setIsDraggingOver(false);
          }
        }
      },
      [structureLocked],
    );

    const onDragOver = useCallback(
      (e: React.DragEvent<HTMLDivElement>) => {
        if (structureLocked) {
          return;
        }
        if (isGcNodeDragEvent(e.nativeEvent)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      },
      [structureLocked],
    );

    const onDrop = useCallback(
      (e: React.DragEvent<HTMLDivElement>) => {
        dragEnterCounterRef.current = 0;
        setIsDraggingOver(false);
        if (structureLocked) {
          return;
        }
        const json = e.dataTransfer.getData(GC_DRAG_NODE_MIME_TYPE);
        if (!json) {
          return;
        }
        e.preventDefault();
        const pick = decodeNodeDragData(json);
        if (!pick) {
          return;
        }
        const project = projectScreenToFlowRef.current;
        if (!project) {
          return;
        }
        const flowPos = project(e.clientX, e.clientY);
        onAddNode(pick, flowPos, undefined);
      },
      [structureLocked, onAddNode],
    );

    const onDeleteNodeFromMenu = useCallback(
      (nodeId: string) => {
        applyRemoveNodeIds([nodeId]);
      },
      [applyRemoveNodeIds],
    );

    const onOpenAddMenuFromHotkey = useCallback(
      (sx: number, sy: number, fx: number, fy: number) => {
        if (structureLocked) {
          return;
        }
        setAddMenu({ sx, sy, fx, fy });
      },
      [structureLocked],
    );

    return (
      <div
        ref={flowWrapRef}
        className={`gc-flow-wrap${isDraggingOver ? " gc-flow-wrap--drop-active" : ""}`}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <GcBranchEdgeUiContext.Provider value={branchEdgeUiValue}>
        <GcViewportTierProvider value={viewportTierValue}>
          <GcCanvasLodProvider value={canvasLod}>
          <GcConnectionDragContext.Provider value={connectionDrag}>
          <ReactFlow
            colorMode="system"
            ariaLabelConfig={flowAriaLabels}
            onlyRenderVisibleElements
            connectionRadius={GC_CONNECTION_RADIUS}
            connectionLineType={gcConnectionLineType}
            connectionLineStyle={connectionLineStyle}
            snapToGrid={snapToGridEnabled}
            snapGrid={[CANVAS_GRID_STEP, CANVAS_GRID_STEP]}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChangeWrapped}
            onEdgesChange={onEdgesChangeWrapped}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            isValidConnection={isValidConnection}
            nodeTypes={nodeTypes}
            edgeTypes={gcEdgeTypes}
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
            <FollowActiveRunCamera
              runHighlightNodeId={runHighlightNodeId}
              followEnabled={followRunCameraEnabled}
              followActive={followRunCameraActive}
              runMotionPreference={runMotionPreference}
              layoutEpoch={layoutEpoch}
            />
            <FlowCanvasHandleBridge
              ref={ref}
              baseDocument={graphDocument}
              onExportRemovedDanglingEdges={onExportRemovedDanglingEdges}
              removeNodesByIdRef={removeNodesByIdRef}
            />
            <Background gap={CANVAS_GRID_STEP} size={1} />
            <Controls />
            <GraphCanvasPaneTools
              flowWrapRef={flowWrapRef}
              structureLocked={structureLocked}
              onOpenAddMenuAt={onOpenAddMenuFromHotkey}
              minimapChrome={minimapChrome}
              minimapNodeColor={minimapNodeColor}
              minimapNodeStrokeColor={minimapNodeStrokeColor}
            />
          </ReactFlow>
          </GcConnectionDragContext.Provider>
          </GcCanvasLodProvider>
        </GcViewportTierProvider>
        </GcBranchEdgeUiContext.Provider>
        <CanvasAddNodeMenu
          open={addMenu != null}
          screenPos={addMenu != null ? { x: addMenu.sx, y: addMenu.sy } : { x: 0, y: 0 }}
          flowPos={addMenu != null ? { x: addMenu.fx, y: addMenu.fy } : { x: 0, y: 0 }}
          hasStartNode={hasStartNode}
          workspaceGraphs={workspaceGraphsForAddMenu}
          connectFilter={addMenuConnectFilter}
          onClose={() => {
            setAddMenu(null);
          }}
          onPick={(pick, flowPosition) => {
            const wire = addMenu?.connectFrom;
            if (wire) {
              onAddNode(pick, flowPosition, wire);
            } else {
              onAddNode(pick, flowPosition, undefined);
            }
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
