// Copyright GraphCaster. All Rights Reserved.

import type { Edge, Node } from "@xyflow/react";
import { useEffect, type Dispatch, type SetStateAction } from "react";

import { gcFlowEdgeDocumentPayloadEqual, gcFlowEdgesSyncKeepSelection } from "../../../graph/gcFlowEdgeSync";
import type { GcNodeData } from "../../../graph/toReactFlow";
import { type NodeRunOverlayEntry, type NodeRunPhase } from "../../../run/nodeRunOverlay";

const GC_NODE_RUN_CLASS_RE = /\bgc-node--run-(active|running|success|failed|skipped)\b/g;
const GC_EDGE_WARN_CLASS = "gc-edge--warning";
const GC_EDGE_RUN_ACTIVE_CLASS = "gc-edge--run-active";
const GC_NODE_RUN_PULSE_RE = /\bgc-node--run-motion-pulse\b/g;

function runHighlightClassNameForNode(
  n: Node<GcNodeData>,
  nodeRunOverlayById: Readonly<Record<string, NodeRunOverlayEntry>>,
  hl: string | null,
  runMotionPulse: boolean,
): { className: string | undefined; effectivePhase: NodeRunPhase | null } {
  const strip = (n.className ?? "")
    .replace(GC_NODE_RUN_CLASS_RE, "")
    .replace(GC_NODE_RUN_PULSE_RE, "")
    .trim();
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
  if (runMotionPulse && phase === "running") {
    runClass = runClass != null ? `${runClass} gc-node--run-motion-pulse` : "gc-node--run-motion-pulse";
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

function mergeRunEdgeHighlight(
  edges: Edge[],
  highlightedEdgeId: string | null,
  edgeAnimated: boolean,
): Edge[] {
  const hilite =
    highlightedEdgeId != null && highlightedEdgeId.trim() !== ""
      ? highlightedEdgeId.trim()
      : null;
  return edges.map((e) => {
    const stripRun = (e.className ?? "").replace(/\bgc-edge--run-active\b/g, "").trim();
    const want = hilite != null && e.id === hilite;
    const className = want
      ? stripRun
        ? `${stripRun} ${GC_EDGE_RUN_ACTIVE_CLASS}`
        : GC_EDGE_RUN_ACTIVE_CLASS
      : stripRun || undefined;
    const animated = want && edgeAnimated ? true : Boolean(e.animated);
    return { ...e, className, animated };
  });
}

export type GraphCanvasFlowFromDocument = {
  nodes: Node<GcNodeData>[];
  edges: Edge[];
};

export function useGraphCanvasDocumentRunOverlaySync({
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
}: {
  flowFromDocument: GraphCanvasFlowFromDocument;
  runHighlightNodeId: string | null;
  nodeRunOverlayForSync: Readonly<Record<string, NodeRunOverlayEntry>>;
  nodeRunOverlayRevision: number | undefined;
  warningEdgeIds: ReadonlySet<string>;
  highlightedRunEdgeId: string | null;
  edgeRunOverlayRevision: number;
  runMotionPulseEnabled: boolean;
  runEdgeAnimated: boolean;
  setNodes: Dispatch<SetStateAction<Node<GcNodeData>[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
}): void {
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
            runMotionPulseEnabled,
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
          runMotionPulseEnabled,
        );
        const curData = cur?.data as GcNodeData | undefined;
        const rawUnchanged =
          curData?.raw === d.raw ||
          (curData != null && JSON.stringify(curData.raw) === JSON.stringify(d.raw));
        if (
          cur &&
          cur.position.x === n.position.x &&
          cur.position.y === n.position.y &&
          cur.parentId === n.parentId &&
          cur.type === n.type &&
          curData?.graphNodeType === d.graphNodeType &&
          curData?.label === d.label &&
          rawUnchanged
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
      const warned = mergeEdgeWarningHighlight(base.edges, warningEdgeIds);
      const he =
        highlightedRunEdgeId != null && highlightedRunEdgeId.trim() !== ""
          ? highlightedRunEdgeId.trim()
          : null;
      const next = mergeRunEdgeHighlight(warned, he, runEdgeAnimated);
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
    highlightedRunEdgeId,
    edgeRunOverlayRevision,
    runMotionPulseEnabled,
    runEdgeAnimated,
    setNodes,
    setEdges,
  ]);
}
