// Copyright GraphCaster. All Rights Reserved.

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { AlertDialog } from "../ui/AlertDialog/AlertDialog";
import { Button } from "../ui/Button/Button";
import { Icon } from "../ui/Icon/Icon";
import type { IconName } from "../ui/Icon/registry";
import { InlineTextEdit } from "../ui/InlineTextEdit/InlineTextEdit";
import { Link } from "../ui/Link/Link";
import { Switch } from "../ui/Switch/Switch";
import { NDVEmptyPlaceholder } from "./NDVEmptyPlaceholder";
import { useNdvLayout } from "./useNdvLayout";
import { useNdvDirty } from "./useNdvDirty";
import { runStore } from "../../run/runStore";
import { useTranslation } from "react-i18next";
import { NdvAiAgent, isAiAgentNodeType } from "./variants/NdvAiAgent";
import "./NDV.css";

/* ── Icon mapping per node type ───────────────────────────────── */
const NODE_TYPE_ICON: Record<string, IconName> = {
  start: "zap",
  exit: "door-open",
  trigger_webhook: "webhook",
  trigger_schedule: "calendar",
  task: "bot",
  llm_agent: "brain",
  agent: "sparkles",
  http_request: "globe",
  rag_query: "database",
  rag_index: "layers",
  delay: "clock",
  debounce: "hourglass",
  wait_for: "circle-pause",
  set_variable: "variable",
  python_code: "code",
  graph_ref: "git-branch",
  merge: "arrow-left-right",
  fork: "split",
  mcp_tool: "mcp",
  ai_route: "sparkles",
};

export function iconForNodeType(nodeType: string): IconName {
  return NODE_TYPE_ICON[nodeType] ?? "circle-ellipsis";
}

/* ── Props ─────────────────────────────────────────────────────── */
export interface NDVProps {
  open: boolean;
  onClose: () => void;
  nodeId: string;
  nodeType: string;
  nodeName: string;
  onNodeNameChange: (name: string) => void;
  inputPanel?: React.ReactNode;
  parametersPanel: React.ReactNode;
  outputPanel?: React.ReactNode;
  isDisabled?: boolean;
  onToggleDisabled?: (disabled: boolean) => void;
  docsUrl?: string;
  readOnly?: boolean;
  /** Called 500ms after the last field change (autosave). */
  onAutosave?: () => void;
  /**
   * Override hook for the "Test step" button. Default behavior calls
   * `runStore.runSingleNode(nodeId)` and shows a toast/log.
   */
  onTestStep?: (nodeId: string) => void;
  /**
   * When set, the "Test step" toolbar button is hidden (e.g. for nodes that
   * cannot run in isolation).
   */
  hideTestStep?: boolean;
  /**
   * Pass `markDirty` / `markClean` down from the host if the host owns the
   * dirty-state hook; otherwise NDV manages its own internal instance.
   */
  dirtyControls?: {
    dirty: boolean;
    errors: Record<string, string>;
    markDirty: () => void;
    markClean: () => void;
  };
}

/* ── Resize hook ───────────────────────────────────────────────── */
function useResizeDrag(
  onSetWidth: (w: number) => void,
  direction: "left" | "right",
) {
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent, currentWidth: number) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startWidthRef.current = currentWidth;
      setDragging(true);

      const onMove = (mv: MouseEvent) => {
        const delta = mv.clientX - startXRef.current;
        const newWidth =
          direction === "right"
            ? startWidthRef.current + delta
            : startWidthRef.current - delta;
        onSetWidth(newWidth);
      };

      const onUp = () => {
        setDragging(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [direction, onSetWidth],
  );

  return { dragging, onMouseDown };
}

/* ── NDV component ─────────────────────────────────────────────── */
export function NDV({
  open,
  onClose,
  nodeId: _nodeId,
  nodeType,
  nodeName,
  onNodeNameChange,
  inputPanel,
  parametersPanel,
  outputPanel,
  isDisabled = false,
  onToggleDisabled,
  docsUrl,
  readOnly = false,
  onAutosave,
  dirtyControls,
  onTestStep,
  hideTestStep = false,
}: NDVProps) {
  const { t } = useTranslation();
  const { inputWidth, outputWidth, setInputWidth, setOutputWidth } =
    useNdvLayout(open ? nodeType : null);

  const internal = useNdvDirty(onAutosave);
  const { dirty, errors, markClean } = dirtyControls ?? internal;

  const [discardOpen, setDiscardOpen] = useState(false);

  const drawerRef = useRef<HTMLDivElement>(null);

  const requestClose = useCallback(() => {
    if (dirty && Object.keys(errors).length > 0) {
      setDiscardOpen(true);
    } else {
      onClose();
    }
  }, [dirty, errors, onClose]);

  /* Close on Escape */
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        requestClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, requestClose]);

  /* Focus drawer on open */
  useEffect(() => {
    if (open) {
      drawerRef.current?.focus();
    }
  }, [open]);

  /* Reset dirty state when NDV is closed */
  useEffect(() => {
    if (!open) {
      markClean();
    }
  }, [open, markClean]);

  const inputDrag = useResizeDrag(setInputWidth, "right");
  const outputDrag = useResizeDrag(setOutputWidth, "left");

  if (!open) return null;

  const panelLayout =
    inputPanel != null && outputPanel != null
      ? "both"
      : inputPanel != null
        ? "input"
        : outputPanel != null
          ? "output"
          : "none";

  const portal = document.getElementById("gc-app-modals") ?? document.body;

  return createPortal(
    <>
      {/* discard-changes confirmation */}
      <AlertDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="You have unsaved changes. Discard?"
        confirmLabel="Discard"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => {
          setDiscardOpen(false);
          markClean();
          onClose();
        }}
        onCancel={() => setDiscardOpen(false)}
      />

      {/* backdrop */}
      <div
        className="gc-ndv-backdrop"
        aria-hidden="true"
        onClick={requestClose}
      />

      {/* drawer */}
      <div
        ref={drawerRef}
        className={[
          "gc-ndv",
          isDisabled ? "gc-ndv--disabled" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label={`Node: ${nodeName}`}
        tabIndex={-1}
        data-nodeid={_nodeId}
      >
        {/* ── Header ──────────────────────────────────────────── */}
        <header className="gc-ndv-header">
          <span className="gc-ndv-header__icon">
            <Icon name={iconForNodeType(nodeType)} size={24} />
          </span>

          <div className="gc-ndv-header__name">
            <InlineTextEdit
              value={nodeName}
              onChange={onNodeNameChange}
              size="large"
              disabled={readOnly}
            />
          </div>

          <div className="gc-ndv-header__spacer" />

          {!hideTestStep && (
            <Button
              variant="subtle"
              size="small"
              iconLeft="zap"
              onClick={() => {
                if (onTestStep) {
                  onTestStep(_nodeId);
                } else {
                  runStore.runSingleNode(_nodeId);
                }
              }}
              aria-label={t("ndv.testStep.ariaLabel")}
              data-testid="ndv-test-step"
              disabled={readOnly || isDisabled}
            >
              {t("ndv.testStep.label")}
            </Button>
          )}

          {docsUrl && (
            <Link
              href={docsUrl}
              target="_blank"
              rel="noreferrer"
              className="gc-ndv-header__docs"
            >
              Docs
              <Icon name="external-link" size={12} />
            </Link>
          )}

          {onToggleDisabled && (
            <>
              <div className="gc-ndv-header__sep" />
              <Switch
                checked={!isDisabled}
                onCheckedChange={(checked) => onToggleDisabled(!checked)}
                size="small"
              />
            </>
          )}

          <Button
            variant="ghost"
            size="small"
            iconLeft="x"
            aria-label="Close"
            onClick={requestClose}
          />
        </header>

        {/* ── 3-panel body ─────────────────────────────────────── */}
        <div className="gc-ndv-body" data-panels={panelLayout}>
          {/* Input panel */}
          <aside
            className="gc-ndv-panel gc-ndv-panel--input"
            style={{ width: inputWidth }}
          >
            {inputPanel ?? <NDVEmptyPlaceholder label="Input data" />}
          </aside>

          {/* Resize handle: input ↔ params */}
          <div
            className={[
              "gc-ndv-resize-handle",
              inputDrag.dragging ? "gc-ndv-resize-handle--dragging" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onMouseDown={(e) => inputDrag.onMouseDown(e, inputWidth)}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize input panel"
          />

          {/* Parameters panel */}
          <main className="gc-ndv-panel gc-ndv-panel--params">
            {isAiAgentNodeType(nodeType) ? (
              <NdvAiAgent nodeId={_nodeId} body={parametersPanel} />
            ) : (
              parametersPanel
            )}
          </main>

          {/* Resize handle: params ↔ output */}
          <div
            className={[
              "gc-ndv-resize-handle",
              outputDrag.dragging ? "gc-ndv-resize-handle--dragging" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onMouseDown={(e) => outputDrag.onMouseDown(e, outputWidth)}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize output panel"
          />

          {/* Output panel */}
          <aside
            className="gc-ndv-panel gc-ndv-panel--output"
            style={{ width: outputWidth }}
          >
            {outputPanel ?? <NDVEmptyPlaceholder label="Output data" />}
          </aside>
        </div>
      </div>
    </>,
    portal,
  );
}

/* ── NDVHost: subscribes to store, renders NDV when active ─────── */
import { useNdvStore } from "./useNdvStore";

export function NDVHost() {
  const activeNodeId = useNdvStore((s) => s.activeNodeId);
  const activeNodeType = useNdvStore((s) => s.activeNodeType);
  const closeNdv = useNdvStore((s) => s.closeNdv);

  if (!activeNodeId || !activeNodeType) return null;

  return (
    <NDV
      open={true}
      onClose={closeNdv}
      nodeId={activeNodeId}
      nodeType={activeNodeType}
      nodeName={activeNodeType}
      onNodeNameChange={() => {}}
      parametersPanel={
        <div style={{ padding: 24, color: "var(--color--text--tint-2, rgba(28,28,30,0.55))" }}>
          Parameters panel (UX90)
        </div>
      }
    />
  );
}
