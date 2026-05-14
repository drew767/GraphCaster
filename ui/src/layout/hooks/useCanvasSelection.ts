// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useRef, useState } from "react";

import type { GraphCanvasSelection } from "../../components/GraphCanvas";
import type { GraphDocumentJson } from "../../graph/types";
import { nodeLabel } from "../../graph/toReactFlow";

export interface UseCanvasSelectionOptions {
  /** Reactive document; used to prune/refresh selection when the doc changes. */
  graphDocument: GraphDocumentJson;
}

export interface UseCanvasSelectionReturn {
  /** Current selection (null when nothing is selected). */
  selection: GraphCanvasSelection | null;
  /** Latest-value ref of `selection` (for hotkey handlers that read on demand). */
  selectionRef: React.MutableRefObject<GraphCanvasSelection | null>;
  /** Replace the selection. */
  setSelection: React.Dispatch<React.SetStateAction<GraphCanvasSelection | null>>;
  /** Clear the selection. */
  clearSelection: () => void;
}

/**
 * Tracks the canvas selection (node, multi-node, or edge) and keeps it in
 * sync with the live document:
 *   - selected nodes/edges that no longer exist are dropped;
 *   - multi-selections that collapse to a single live node become a single-node
 *     selection (matches legacy AppShell behaviour);
 *   - edge selections re-read `condition` and `routeDescription` from the doc.
 */
export function useCanvasSelection(
  options: UseCanvasSelectionOptions,
): UseCanvasSelectionReturn {
  const { graphDocument } = options;
  const [selection, setSelection] = useState<GraphCanvasSelection | null>(null);
  const selectionRef = useRef<GraphCanvasSelection | null>(selection);
  selectionRef.current = selection;

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  useEffect(() => {
    setSelection((sel) => {
      if (!sel) {
        return sel;
      }
      const nodes = graphDocument.nodes ?? [];
      const edges = graphDocument.edges ?? [];
      if (sel.kind === "node") {
        if (!nodes.some((n) => n.id === sel.id)) {
          return null;
        }
        return sel;
      }
      if (sel.kind === "multiNode") {
        const alive = sel.ids.filter((id) => nodes.some((n) => n.id === id));
        if (alive.length === 0) {
          return null;
        }
        if (alive.length === 1) {
          const n = nodes.find((x) => x.id === alive[0]);
          if (!n) {
            return null;
          }
          const raw = n.data ?? {};
          return {
            kind: "node",
            id: n.id,
            graphNodeType: n.type,
            label: nodeLabel(raw, n.id),
            raw,
          };
        }
        const rows = alive.map((id) => {
          const n = nodes.find((x) => x.id === id);
          if (!n) {
            return { id, graphNodeType: "unknown", label: id };
          }
          const raw = n.data ?? {};
          return {
            id,
            graphNodeType: n.type,
            label: nodeLabel(raw, id),
          };
        });
        return { kind: "multiNode", ids: alive, nodes: rows };
      }
      if (sel.kind === "edge") {
        const ej = edges.find((e) => e.id === sel.id);
        if (!ej) {
          return null;
        }
        const d = ej.data;
        const rd =
          d != null &&
          typeof d === "object" &&
          !Array.isArray(d) &&
          typeof d.routeDescription === "string"
            ? d.routeDescription
            : "";
        const cond =
          ej.condition != null && String(ej.condition).trim() !== ""
            ? String(ej.condition)
            : null;
        return { ...sel, condition: cond, routeDescription: rd };
      }
      return sel;
    });
  }, [graphDocument]);

  return {
    selection,
    selectionRef,
    setSelection,
    clearSelection,
  };
}
