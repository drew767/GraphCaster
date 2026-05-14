// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useRef, useState, type RefObject } from "react";
import type { GraphCanvasHandle } from "../../components/GraphCanvas";
import type { GraphDocumentJson } from "../../graph/types";
import {
  clearHistory,
  createEmptyHistory,
  documentJsonSignature,
  redoDocument,
  snapshotBeforeChange,
  undoDocument,
  type DocumentHistoryState,
} from "../../graph/documentHistory";

export const DOCUMENT_HISTORY_CAP_DEFAULT = 80;

export interface UseGraphDocumentHistoryOptions {
  /** Maximum number of past snapshots to retain. */
  historyCap?: number;
  /** Ref to the canvas; used to read current document via `exportDocument`. */
  canvasRef: RefObject<GraphCanvasHandle | null>;
  /** Ref to the latest graph document (fallback when canvas not mounted). */
  graphDocumentRef: RefObject<GraphDocumentJson>;
  /** Set the current document. Called from undo/redo. */
  setGraphDocument: (doc: GraphDocumentJson) => void;
  /** Clear any "dangling edges" UI marker. Called from undo/redo. */
  setDanglingEdgesExportIds: (ids: string[] | null) => void;
  /** Bump layout dirty counter. Called from undo/redo to trigger re-layout. */
  bumpLayoutDirtyEpoch: () => void;
  /** Returns true when a run session is blocking edits; short-circuits all mutations. */
  isRunBlocking: () => boolean;
}

export interface UseGraphDocumentHistoryReturn {
  /** Mutable ref to the history state. */
  historyRef: React.MutableRefObject<DocumentHistoryState>;
  /** Counter that bumps on every history mutation so UI can re-read `historyRef`. */
  historyTick: number;
  /** Increment `historyTick` manually (used when clearing externally). */
  bumpHistoryUi: () => void;
  /** Snapshot the current document before a mutation. */
  commitHistorySnapshot: () => void;
  /** Capture pre-drag document, so we can detect changes after the drag. */
  beginNodeDragCapture: () => void;
  /** If pre-drag and post-drag documents differ, push the pre-drag onto history. */
  commitNodeDragHistoryIfChanged: () => void;
  /** Perform undo if possible. */
  performUndo: () => void;
  /** Perform redo if possible. */
  performRedo: () => void;
  /** Wipe history (e.g., after loading a new document). */
  resetHistory: () => void;
  /** Clear pre-drag capture without committing (e.g., when loading a new doc). */
  clearPreDragCapture: () => void;
}

/**
 * Manages graph document undo/redo history at the AppShell level.
 *
 * Pre-conditions enforced internally:
 *   - All mutations are skipped while `isRunBlocking()` returns true.
 *   - When the canvas is mounted, the current document is read from the canvas
 *     (which carries unsynced layout). Otherwise falls back to `graphDocumentRef`.
 *
 * Side-effects applied on undo/redo:
 *   - `setDanglingEdgesExportIds(null)` clears the dangling edge banner.
 *   - `setGraphDocument(doc)` replaces the document.
 *   - `bumpLayoutDirtyEpoch()` forces React Flow to recompute layout.
 */
export function useGraphDocumentHistory(
  options: UseGraphDocumentHistoryOptions,
): UseGraphDocumentHistoryReturn {
  const {
    historyCap = DOCUMENT_HISTORY_CAP_DEFAULT,
    canvasRef,
    graphDocumentRef,
    setGraphDocument,
    setDanglingEdgesExportIds,
    bumpLayoutDirtyEpoch,
    isRunBlocking,
  } = options;

  const historyRef = useRef<DocumentHistoryState>(createEmptyHistory(historyCap));
  const preDragDocumentRef = useRef<GraphDocumentJson | null>(null);
  const [historyTick, setHistoryTick] = useState(0);

  const bumpHistoryUi = useCallback(() => {
    setHistoryTick((n) => n + 1);
  }, []);

  const readCurrentDocument = useCallback((): GraphDocumentJson => {
    return (
      canvasRef.current?.exportDocument({ notifyRemovedDanglingEdges: false }) ??
      graphDocumentRef.current
    );
  }, [canvasRef, graphDocumentRef]);

  const commitHistorySnapshot = useCallback(() => {
    preDragDocumentRef.current = null;
    if (isRunBlocking()) {
      return;
    }
    const current = readCurrentDocument();
    historyRef.current = snapshotBeforeChange(historyRef.current, current);
    bumpHistoryUi();
  }, [bumpHistoryUi, isRunBlocking, readCurrentDocument]);

  const beginNodeDragCapture = useCallback(() => {
    if (isRunBlocking()) {
      return;
    }
    const api = canvasRef.current;
    if (!api) {
      return;
    }
    preDragDocumentRef.current = structuredClone(
      api.exportDocument({ notifyRemovedDanglingEdges: false }),
    ) as GraphDocumentJson;
  }, [canvasRef, isRunBlocking]);

  const commitNodeDragHistoryIfChanged = useCallback(() => {
    if (isRunBlocking()) {
      preDragDocumentRef.current = null;
      return;
    }
    const pre = preDragDocumentRef.current;
    preDragDocumentRef.current = null;
    if (pre == null) {
      return;
    }
    const api = canvasRef.current;
    if (!api) {
      return;
    }
    const after = api.exportDocument({ notifyRemovedDanglingEdges: false });
    if (documentJsonSignature(pre) === documentJsonSignature(after)) {
      return;
    }
    historyRef.current = snapshotBeforeChange(historyRef.current, pre);
    bumpHistoryUi();
  }, [bumpHistoryUi, canvasRef, isRunBlocking]);

  const performUndo = useCallback(() => {
    preDragDocumentRef.current = null;
    if (isRunBlocking()) {
      return;
    }
    const current = readCurrentDocument();
    const r = undoDocument(historyRef.current, current);
    if (!r) {
      return;
    }
    historyRef.current = r.nextHistory;
    setDanglingEdgesExportIds(null);
    setGraphDocument(r.document);
    bumpLayoutDirtyEpoch();
    bumpHistoryUi();
  }, [
    bumpHistoryUi,
    bumpLayoutDirtyEpoch,
    isRunBlocking,
    readCurrentDocument,
    setDanglingEdgesExportIds,
    setGraphDocument,
  ]);

  const performRedo = useCallback(() => {
    preDragDocumentRef.current = null;
    if (isRunBlocking()) {
      return;
    }
    const current = readCurrentDocument();
    const r = redoDocument(historyRef.current, current);
    if (!r) {
      return;
    }
    historyRef.current = r.nextHistory;
    setDanglingEdgesExportIds(null);
    setGraphDocument(r.document);
    bumpLayoutDirtyEpoch();
    bumpHistoryUi();
  }, [
    bumpHistoryUi,
    bumpLayoutDirtyEpoch,
    isRunBlocking,
    readCurrentDocument,
    setDanglingEdgesExportIds,
    setGraphDocument,
  ]);

  const resetHistory = useCallback(() => {
    historyRef.current = clearHistory(historyRef.current);
    bumpHistoryUi();
  }, [bumpHistoryUi]);

  const clearPreDragCapture = useCallback(() => {
    preDragDocumentRef.current = null;
  }, []);

  return {
    historyRef,
    historyTick,
    bumpHistoryUi,
    commitHistorySnapshot,
    beginNodeDragCapture,
    commitNodeDragHistoryIfChanged,
    performUndo,
    performRedo,
    resetHistory,
    clearPreDragCapture,
  };
}
