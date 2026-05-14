// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useRef, useState } from "react";
import type { GraphDocumentJson } from "../../graph/types";
import {
  clearHistory,
  createEmptyHistory,
  redoDocument,
  snapshotBeforeChange,
  undoDocument,
  type DocumentHistoryState,
} from "../../graph/documentHistory";

export interface UseDocumentHistoryOptions {
  historyCap?: number;
}

export interface UseDocumentHistoryReturn {
  /** Direct access to history state ref (for cases needing manual manipulation) */
  historyRef: React.MutableRefObject<DocumentHistoryState>;
  /** Incremented counter to trigger re-renders when history changes */
  historyTick: number;
  /** Manually bump the history tick to trigger UI update */
  bumpHistoryTick: () => void;
  /** Snapshot document into history past stack */
  snapshotDocument: (doc: GraphDocumentJson) => void;
  /** Try to undo: returns previous document or null if nothing to undo */
  tryUndo: (currentDoc: GraphDocumentJson) => GraphDocumentJson | null;
  /** Try to redo: returns next document or null if nothing to redo */
  tryRedo: (currentDoc: GraphDocumentJson) => GraphDocumentJson | null;
  /** Clear all history */
  clearHistory: () => void;
  /** Whether undo is available */
  canUndo: boolean;
  /** Whether redo is available */
  canRedo: boolean;
}

const DEFAULT_HISTORY_CAP = 80;

/**
 * Manages document undo/redo history.
 * 
 * This hook provides low-level history operations. The caller is responsible for:
 * - Checking if history operations are allowed (e.g., run session blocking)
 * - Applying side effects after undo/redo (e.g., setGraphDocument, setLayoutDirtyEpoch)
 * - Getting the current document from the appropriate source (canvas or state)
 */
export function useDocumentHistory(
  options: UseDocumentHistoryOptions = {},
): UseDocumentHistoryReturn {
  const { historyCap = DEFAULT_HISTORY_CAP } = options;
  const historyRef = useRef<DocumentHistoryState>(createEmptyHistory(historyCap));
  const [historyTick, setHistoryTick] = useState(0);

  const bumpHistoryTick = useCallback(() => {
    setHistoryTick((n) => n + 1);
  }, []);

  const snapshotDocument = useCallback((doc: GraphDocumentJson) => {
    historyRef.current = snapshotBeforeChange(historyRef.current, doc);
    setHistoryTick((n) => n + 1);
  }, []);

  const tryUndo = useCallback(
    (currentDoc: GraphDocumentJson): GraphDocumentJson | null => {
      const result = undoDocument(historyRef.current, currentDoc);
      if (result) {
        historyRef.current = result.nextHistory;
        setHistoryTick((n) => n + 1);
        return result.document;
      }
      return null;
    },
    [],
  );

  const tryRedo = useCallback(
    (currentDoc: GraphDocumentJson): GraphDocumentJson | null => {
      const result = redoDocument(historyRef.current, currentDoc);
      if (result) {
        historyRef.current = result.nextHistory;
        setHistoryTick((n) => n + 1);
        return result.document;
      }
      return null;
    },
    [],
  );

  const clearHistoryCallback = useCallback(() => {
    historyRef.current = clearHistory(historyRef.current);
    setHistoryTick((n) => n + 1);
  }, []);

  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  return {
    historyRef,
    historyTick,
    bumpHistoryTick,
    snapshotDocument,
    tryUndo,
    tryRedo,
    clearHistory: clearHistoryCallback,
    canUndo,
    canRedo,
  };
}
