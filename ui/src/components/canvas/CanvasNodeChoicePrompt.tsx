// Copyright GraphCaster. All Rights Reserved.
// UX75 — empty-canvas choice prompt: Add node vs Build with AI.

import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "../ui/Icon/Icon";
import "./CanvasNodeChoicePrompt.css";

export interface CanvasNodeChoicePromptProps {
  open: boolean;
  onAddNode: () => void;
  onBuildWithAI: () => void;
  className?: string;
}

function CanvasNodeChoicePromptInner({
  open,
  onAddNode,
  onBuildWithAI,
  className,
}: CanvasNodeChoicePromptProps) {
  const { t } = useTranslation();

  const handleAddNode = useCallback(() => {
    onAddNode();
  }, [onAddNode]);

  const handleBuildWithAI = useCallback(() => {
    onBuildWithAI();
  }, [onBuildWithAI]);

  if (!open) return null;

  return (
    <div
      className={["gc-canvas-choice-prompt", className].filter(Boolean).join(" ")}
      aria-label={t("app.canvas.choicePrompt.panelLabel")}
      data-testid="canvas-choice-prompt"
    >
      <p className="gc-canvas-choice-prompt__heading">
        {t("app.canvas.choicePrompt.heading")}
      </p>

      <div className="gc-canvas-choice-prompt__cards">
        {/* Add node card */}
        <div className="gc-canvas-choice-prompt__card">
          <button
            type="button"
            className="gc-canvas-choice-prompt__card-btn"
            onClick={handleAddNode}
            aria-label={t("app.canvas.choicePrompt.addNodeLabel")}
            data-testid="choice-prompt-add-node-btn"
          >
            <Icon name="plus" size={36} aria-hidden />
          </button>
          <span className="gc-canvas-choice-prompt__card-label" aria-hidden="true">
            {t("app.canvas.choicePrompt.addNodeLabel")}
          </span>
        </div>

        <span className="gc-canvas-choice-prompt__divider" aria-hidden="true">
          {t("app.canvas.choicePrompt.or")}
        </span>

        {/* Build with AI card */}
        <div className="gc-canvas-choice-prompt__card">
          <button
            type="button"
            className="gc-canvas-choice-prompt__card-btn"
            onClick={handleBuildWithAI}
            aria-label={t("app.canvas.choicePrompt.buildWithAILabel")}
            data-testid="choice-prompt-build-ai-btn"
          >
            <Icon name="wand-sparkles" size={36} aria-hidden />
          </button>
          <span className="gc-canvas-choice-prompt__card-label" aria-hidden="true">
            {t("app.canvas.choicePrompt.buildWithAILabel")}
          </span>
        </div>
      </div>
    </div>
  );
}

export const CanvasNodeChoicePrompt = memo(CanvasNodeChoicePromptInner);
CanvasNodeChoicePrompt.displayName = "CanvasNodeChoicePrompt";
