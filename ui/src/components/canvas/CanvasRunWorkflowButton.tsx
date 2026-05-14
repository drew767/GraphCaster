// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { isTextEditingTarget } from "../../lib/isTextEditingTarget";
import { Button } from "../ui/Button/Button";
import { Tooltip } from "../ui/Tooltip/Tooltip";

export type CanvasRunWorkflowButtonProps = {
  /** Called when the user triggers a run (idle state). */
  onRun: () => void;
  /** True while a run is active — shows "Executing…" spinner. */
  running?: boolean;
  /** When true the button is disabled (e.g. run already executing and cannot stop). */
  disabled?: boolean;
  /**
   * List of trigger node ids/labels when the graph has more than one trigger.
   * If non-empty a split-button with a dropdown appears to choose the starting trigger.
   */
  triggerOptions?: ReadonlyArray<{ id: string; label: string }>;
  /** Called when a specific trigger is selected from the dropdown. */
  onRunFromTrigger?: (triggerId: string) => void;
};

/**
 * UX79 — Prominent "Run workflow" button anchored at the bottom-center of the canvas.
 *
 * States:
 *   idle     — primary "Run workflow" button (Ctrl+Enter hotkey).
 *   running  — disabled spinner "Executing…".
 *   multiple triggers — split button with dropdown of trigger options.
 *
 * The button is positioned in the canvas viewport overlay (not scaled with zoom).
 */
export function CanvasRunWorkflowButton({
  onRun,
  running = false,
  disabled = false,
  triggerOptions,
  onRunFromTrigger,
}: CanvasRunWorkflowButtonProps) {
  const { t } = useTranslation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const hasMultipleTriggers = (triggerOptions?.length ?? 0) > 1;

  const handleRun = useCallback(() => {
    if (running || disabled) {
      return;
    }
    setDropdownOpen(false);
    onRun();
  }, [running, disabled, onRun]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key !== "Enter") {
        return;
      }
      if (isTextEditingTarget(e.target)) {
        return;
      }
      if (running || disabled) {
        return;
      }
      e.preventDefault();
      onRun();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [running, disabled, onRun]);

  useEffect(() => {
    if (!dropdownOpen) {
      return;
    }
    const onClickOut = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest(".gc-canvas-run-btn")) {
        setDropdownOpen(false);
      }
    };
    window.addEventListener("mousedown", onClickOut);
    return () => {
      window.removeEventListener("mousedown", onClickOut);
    };
  }, [dropdownOpen]);

  return (
    <div className="gc-canvas-run-btn" data-testid="canvas-run-workflow-button">
      {hasMultipleTriggers ? (
        <>
          <Tooltip
            content={
              <span>
                {t("app.canvas.run.runWorkflow")}
                {" "}
                <span className="gc-canvas-run-btn__hint">Ctrl+Enter</span>
              </span>
            }
            side="top"
          >
            <Button
              variant="solid"
              size="medium"
              loading={running}
              disabled={disabled || running}
              onClick={handleRun}
              className="gc-canvas-run-btn__primary"
              aria-label={t("app.canvas.run.runWorkflow")}
              data-testid="canvas-run-btn-primary"
            >
              {running
                ? t("app.canvas.run.executing")
                : t("app.canvas.run.runWorkflow")}
            </Button>
          </Tooltip>
          <Tooltip content={t("app.canvas.run.chooseTrigger")} side="top">
            <button
              type="button"
              className="gc-canvas-run-btn__arrow"
              onClick={() => setDropdownOpen((prev) => !prev)}
              disabled={disabled || running}
              aria-label={t("app.canvas.run.chooseTrigger")}
              aria-expanded={dropdownOpen}
              aria-haspopup="listbox"
              data-testid="canvas-run-btn-arrow"
            >
              ▾
            </button>
          </Tooltip>
          {dropdownOpen && triggerOptions ? (
            <ul
              className="gc-canvas-run-btn__dropdown"
              role="listbox"
              aria-label={t("app.canvas.run.chooseTrigger")}
              data-testid="canvas-run-btn-dropdown"
            >
              {triggerOptions.map((opt) => (
                <li
                  key={opt.id}
                  role="option"
                  aria-selected={false}
                  className="gc-canvas-run-btn__option"
                  onClick={() => {
                    setDropdownOpen(false);
                    onRunFromTrigger?.(opt.id);
                  }}
                >
                  {opt.label}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <Tooltip
          content={
            <span>
              {t("app.canvas.run.runWorkflow")}
              {" "}
              <span className="gc-canvas-run-btn__hint">Ctrl+Enter</span>
            </span>
          }
          side="top"
        >
          <Button
            variant="solid"
            size="medium"
            loading={running}
            disabled={disabled || running}
            onClick={handleRun}
            className="gc-canvas-run-btn__primary"
            aria-label={t("app.canvas.run.runWorkflow")}
            data-testid="canvas-run-btn-primary"
          >
            {running
              ? t("app.canvas.run.executing")
              : t("app.canvas.run.runWorkflow")}
          </Button>
        </Tooltip>
      )}
    </div>
  );
}
