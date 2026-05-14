// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useRef, useState } from "react";

import type { AppMessagePresentation } from "../../graph/openGraphErrorPresentation";
import { isTextEditingTarget } from "../../lib/isTextEditingTarget";

export interface UseModalsControllerReturn {
  // Save modal
  saveModalOpen: boolean;
  saveModalSuggestedName: string;
  openSaveModal: (suggestedName: string) => void;
  closeSaveModal: () => void;

  // App message / error modal
  appMessageModal: AppMessagePresentation | null;
  setAppMessageModal: React.Dispatch<React.SetStateAction<AppMessagePresentation | null>>;
  closeAppMessageModal: () => void;

  // Node search palette
  nodeSearchOpen: boolean;
  /** Latest-value ref of `nodeSearchOpen`, for use inside keyboard handlers. */
  nodeSearchOpenRef: React.MutableRefObject<boolean>;
  openNodeSearch: () => void;
  closeNodeSearch: () => void;

  // Keyboard shortcuts modal
  keyboardShortcutsOpen: boolean;
  openKeyboardShortcuts: () => void;
  closeKeyboardShortcuts: () => void;

  // Run history modal
  runHistoryOpen: boolean;
  openRunHistory: () => void;
  closeRunHistory: () => void;
}

/**
 * Centralised open/close state and keyboard hotkeys for the top-level modals
 * (save, app message/error, node search, keyboard shortcuts, run history).
 *
 * Each modal is its own boolean — at most one is typically open at a time
 * (enforced by the UX, not by this hook), and components already unmount their
 * internals when `open` is false. A "single-modal" guard would be a larger
 * change and is intentionally out of scope here — TODO if we need stricter
 * lifecycle: route all opens through a single `activeModal` discriminator.
 */
export function useModalsController(): UseModalsControllerReturn {
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveModalSuggestedName, setSaveModalSuggestedName] = useState("graph.json");
  const [appMessageModal, setAppMessageModal] = useState<AppMessagePresentation | null>(null);
  const [nodeSearchOpen, setNodeSearchOpen] = useState(false);
  const [keyboardShortcutsOpen, setKeyboardShortcutsOpen] = useState(false);
  const [runHistoryOpen, setRunHistoryOpen] = useState(false);

  const nodeSearchOpenRef = useRef(nodeSearchOpen);
  nodeSearchOpenRef.current = nodeSearchOpen;

  const openSaveModal = useCallback((suggestedName: string) => {
    setSaveModalSuggestedName(suggestedName);
    setSaveModalOpen(true);
  }, []);
  const closeSaveModal = useCallback(() => {
    setSaveModalOpen(false);
  }, []);

  const closeAppMessageModal = useCallback(() => {
    setAppMessageModal(null);
  }, []);

  const openNodeSearch = useCallback(() => {
    setNodeSearchOpen(true);
  }, []);
  const closeNodeSearch = useCallback(() => {
    setNodeSearchOpen(false);
  }, []);

  const openKeyboardShortcuts = useCallback(() => {
    setKeyboardShortcutsOpen(true);
  }, []);
  const closeKeyboardShortcuts = useCallback(() => {
    setKeyboardShortcutsOpen(false);
  }, []);

  const openRunHistory = useCallback(() => {
    setRunHistoryOpen(true);
  }, []);
  const closeRunHistory = useCallback(() => {
    setRunHistoryOpen(false);
  }, []);

  // Ctrl+F / Ctrl+K → open node search palette.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (nodeSearchOpen) {
        return;
      }
      if (isTextEditingTarget(e.target)) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "f" || k === "k") {
        e.preventDefault();
        setNodeSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [nodeSearchOpen]);

  // F1 / ? → open the keyboard shortcuts modal.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isF1 = e.key === "F1";
      const isQuestionMark =
        (e.key === "?" || (e.key === "/" && e.shiftKey)) && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (!isF1 && !isQuestionMark) {
        return;
      }
      if (isTextEditingTarget(e.target)) {
        return;
      }
      e.preventDefault();
      setKeyboardShortcutsOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return {
    saveModalOpen,
    saveModalSuggestedName,
    openSaveModal,
    closeSaveModal,
    appMessageModal,
    setAppMessageModal,
    closeAppMessageModal,
    nodeSearchOpen,
    nodeSearchOpenRef,
    openNodeSearch,
    closeNodeSearch,
    keyboardShortcutsOpen,
    openKeyboardShortcuts,
    closeKeyboardShortcuts,
    runHistoryOpen,
    openRunHistory,
    closeRunHistory,
  };
}
