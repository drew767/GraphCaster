// Copyright GraphCaster. All Rights Reserved.

import { useEffect } from "react";

import { isTextEditingTarget } from "../lib/isTextEditingTarget";

export type CanvasKeybindingHandlers = {
  /* ── selection ── */
  onSelectAll?: () => void;
  onSelectAdjacentUp?: () => void;
  onSelectAdjacentDown?: () => void;
  onSelectAdjacentLeft?: () => void;
  onSelectAdjacentRight?: () => void;
  onSelectUpstream?: () => void;
  onSelectDownstream?: () => void;

  /* ── view ── */
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
  onFitView?: () => void;
  onToggleLogs?: () => void;
  onToggleInputLogs?: () => void;
  onToggleOutputLogs?: () => void;
  onToggleZoomMode?: () => void;

  /* ── edit ── */
  onCutNodes?: () => void;
  onDisable?: () => void;
  onPin?: () => void;
  /** Ctrl+B — toggle bypass mode for selection (UX127a). */
  onBypass?: () => void;
  /** Ctrl+M — toggle mute mode for selection (UX128a). */
  onMute?: () => void;
  /** Alt+C — toggle collapsed visual for selection (UX129). */
  onCollapse?: () => void;
  onAddNode?: () => void;
  onTidyUp?: () => void;
  onStartChat?: () => void;
  onReplaceNode?: () => void;
  onCopyTestWebhookUrl?: () => void;
  onCopyProductionWebhookUrl?: () => void;
  onAddToAiFocus?: () => void;
  onAddSticky?: () => void;
};

function matchesKey(
  e: KeyboardEvent,
  opts: {
    key: string | string[];
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  },
): boolean {
  const keys = Array.isArray(opts.key) ? opts.key : [opts.key];
  const keyMatch = keys.some((k) => e.key === k);
  if (!keyMatch) {
    return false;
  }
  const ctrlOrMeta = e.ctrlKey || e.metaKey;
  if (opts.ctrl != null && ctrlOrMeta !== opts.ctrl) {
    return false;
  }
  if (opts.shift != null && e.shiftKey !== opts.shift) {
    return false;
  }
  if (opts.alt != null && e.altKey !== opts.alt) {
    return false;
  }
  return true;
}

/**
 * Registers canvas keyboard shortcuts matching the n8n hotkey catalog.
 * Skips when focus is in an input / contenteditable area.
 * Each binding invokes the matching handler from `handlers` when provided;
 * the caller is responsible for wiring the actual behaviour.
 */
export function useCanvasKeybindings(handlers: CanvasKeybindingHandlers): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextEditingTarget(e.target)) {
        return;
      }

      /* ── selection ── */
      if (matchesKey(e, { key: "a", ctrl: true, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onSelectAll?.();
        return;
      }

      if (matchesKey(e, { key: "ArrowUp", ctrl: false, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onSelectAdjacentUp?.();
        return;
      }

      if (matchesKey(e, { key: "ArrowDown", ctrl: false, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onSelectAdjacentDown?.();
        return;
      }

      if (matchesKey(e, { key: "ArrowLeft", ctrl: false, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onSelectAdjacentLeft?.();
        return;
      }

      if (matchesKey(e, { key: "ArrowRight", ctrl: false, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onSelectAdjacentRight?.();
        return;
      }

      if (matchesKey(e, { key: "ArrowLeft", ctrl: false, shift: true, alt: false })) {
        e.preventDefault();
        handlers.onSelectUpstream?.();
        return;
      }

      if (matchesKey(e, { key: "ArrowRight", ctrl: false, shift: true, alt: false })) {
        e.preventDefault();
        handlers.onSelectDownstream?.();
        return;
      }

      /* ── view ── */
      if (matchesKey(e, { key: ["+", "="], ctrl: false, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onZoomIn?.();
        return;
      }

      if (matchesKey(e, { key: ["+", "="], ctrl: false, shift: true, alt: false })) {
        e.preventDefault();
        handlers.onZoomIn?.();
        return;
      }

      if (matchesKey(e, { key: ["-", "_"], ctrl: false, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onZoomOut?.();
        return;
      }

      if (matchesKey(e, { key: ["-", "_"], ctrl: false, shift: true, alt: false })) {
        e.preventDefault();
        handlers.onZoomOut?.();
        return;
      }

      if (matchesKey(e, { key: "0", ctrl: false, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onZoomReset?.();
        return;
      }

      if (matchesKey(e, { key: "1", ctrl: false, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onFitView?.();
        return;
      }

      if (matchesKey(e, { key: "L", ctrl: false, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onToggleLogs?.();
        return;
      }

      if (matchesKey(e, { key: "I", ctrl: false, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onToggleInputLogs?.();
        return;
      }

      if (matchesKey(e, { key: "O", ctrl: false, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onToggleOutputLogs?.();
        return;
      }

      if (matchesKey(e, { key: "Z", ctrl: false, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onToggleZoomMode?.();
        return;
      }

      /* ── edit ── */
      if (matchesKey(e, { key: "x", ctrl: true, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onCutNodes?.();
        return;
      }

      if (matchesKey(e, { key: "D", ctrl: false, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onDisable?.();
        return;
      }

      if (matchesKey(e, { key: "p", ctrl: false, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onPin?.();
        return;
      }

      if (matchesKey(e, { key: "P", ctrl: false, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onPin?.();
        return;
      }

      if (matchesKey(e, { key: ["b", "B"], ctrl: true, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onBypass?.();
        return;
      }

      if (matchesKey(e, { key: ["m", "M"], ctrl: true, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onMute?.();
        return;
      }

      if (matchesKey(e, { key: ["c", "C"], ctrl: false, shift: false, alt: true })) {
        e.preventDefault();
        handlers.onCollapse?.();
        return;
      }

      if (matchesKey(e, { key: "n", ctrl: false, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onAddNode?.();
        return;
      }

      if (matchesKey(e, { key: "N", ctrl: false, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onAddNode?.();
        return;
      }

      if (matchesKey(e, { key: "T", ctrl: false, shift: true, alt: true })) {
        e.preventDefault();
        handlers.onTidyUp?.();
        return;
      }

      if (matchesKey(e, { key: "C", ctrl: false, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onStartChat?.();
        return;
      }

      if (matchesKey(e, { key: "R", ctrl: false, shift: false, alt: false })) {
        e.preventDefault();
        handlers.onReplaceNode?.();
        return;
      }

      if (matchesKey(e, { key: "U", ctrl: false, shift: true, alt: true })) {
        e.preventDefault();
        handlers.onCopyTestWebhookUrl?.();
        return;
      }

      if (matchesKey(e, { key: "U", ctrl: false, shift: false, alt: true })) {
        e.preventDefault();
        handlers.onCopyProductionWebhookUrl?.();
        return;
      }

      if (matchesKey(e, { key: "I", ctrl: false, shift: false, alt: true })) {
        e.preventDefault();
        handlers.onAddToAiFocus?.();
        return;
      }

      if (matchesKey(e, { key: "S", ctrl: false, shift: true, alt: false })) {
        e.preventDefault();
        handlers.onAddSticky?.();
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [handlers]);
}
