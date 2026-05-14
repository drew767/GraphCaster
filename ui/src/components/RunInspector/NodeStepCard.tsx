// Copyright GraphCaster. All Rights Reserved.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { NodeStep } from "./traceTree";

type Props = {
  step: NodeStep;
  onReplay?: (nodeId: string) => void;
  onNavigate?: (nodeId: string) => void;
};

const STATUS_CLASS: Record<string, string> = {
  running: "gc-ri-badge--running",
  done: "gc-ri-badge--done",
  error: "gc-ri-badge--error",
  cached: "gc-ri-badge--cached",
  cancelled: "gc-ri-badge--cancelled",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export function NodeStepCard({ step, onReplay, onNavigate }: Props) {
  const { t } = useTranslation();
  const [inputsOpen, setInputsOpen] = useState(false);
  const [outputsOpen, setOutputsOpen] = useState(false);

  const statusLabel = t(`app.runInspector.status.${step.status}`, { defaultValue: step.status });
  const badgeClass = STATUS_CLASS[step.status] ?? "";

  const hasInputs = step.inputs != null;
  const hasOutputs = step.outputs != null;
  const hasError = step.error != null;
  const hasLlm = step.llm != null;

  return (
    <div
      className={`gc-ri-card gc-ri-card--${step.status}`}
      data-testid={`gc-ri-card-${step.nodeId}`}
    >
      <div className="gc-ri-card__header">
        <div className="gc-ri-card__title">
          <span className="gc-ri-card__node-type">{step.type ?? "node"}</span>
          <span
            className="gc-ri-card__node-id"
            role={onNavigate ? "button" : undefined}
            tabIndex={onNavigate ? 0 : undefined}
            onClick={() => onNavigate?.(step.nodeId)}
            onKeyDown={(e) => {
              if (onNavigate && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onNavigate(step.nodeId);
              }
            }}
          >
            {step.nodeId}
          </span>
        </div>
        <div className="gc-ri-card__meta">
          {step.durationMs != null ? (
            <span className="gc-ri-card__duration">{formatDuration(step.durationMs)}</span>
          ) : null}
          <span className={`gc-ri-badge ${badgeClass}`} data-testid={`gc-ri-badge-${step.nodeId}`}>
            {statusLabel}
          </span>
        </div>
      </div>

      {hasError ? (
        <div className="gc-ri-card__error" data-testid={`gc-ri-error-${step.nodeId}`}>
          <strong>{step.error!.message}</strong>
          {step.error!.stack ? (
            <pre className="gc-ri-card__stack">{step.error!.stack}</pre>
          ) : null}
        </div>
      ) : null}

      {hasLlm ? (
        <div className="gc-ri-card__llm" data-testid={`gc-ri-llm-${step.nodeId}`}>
          <span>{step.llm!.provider}</span>
          <span> / </span>
          <span>{step.llm!.model}</span>
          <span className="gc-ri-card__llm-tokens">{step.llm!.tokens} tokens</span>
          {step.llm!.costUsd > 0 ? (
            <span className="gc-ri-card__llm-cost">${step.llm!.costUsd.toFixed(4)}</span>
          ) : null}
        </div>
      ) : null}

      {hasInputs ? (
        <div className="gc-ri-card__section">
          <button
            type="button"
            className="gc-ri-card__section-toggle"
            aria-expanded={inputsOpen}
            onClick={() => setInputsOpen((v) => !v)}
          >
            {t("app.runInspector.inputs")}
          </button>
          {inputsOpen ? (
            <pre className="gc-ri-card__json" data-testid={`gc-ri-inputs-${step.nodeId}`}>
              {JSON.stringify(step.inputs, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}

      {hasOutputs ? (
        <div className="gc-ri-card__section">
          <button
            type="button"
            className="gc-ri-card__section-toggle"
            aria-expanded={outputsOpen}
            onClick={() => setOutputsOpen((v) => !v)}
          >
            {t("app.runInspector.outputs")}
          </button>
          {outputsOpen ? (
            <pre className="gc-ri-card__json" data-testid={`gc-ri-outputs-${step.nodeId}`}>
              {JSON.stringify(step.outputs, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}

      {step.iterations && step.iterations.length > 0 ? (
        <div className="gc-ri-card__iterations" data-testid={`gc-ri-iterations-${step.nodeId}`}>
          {step.iterations.map((iter) => (
            <NodeStepCard key={iter.nodeId} step={iter} onReplay={onReplay} onNavigate={onNavigate} />
          ))}
        </div>
      ) : null}

      {onReplay ? (
        <div className="gc-ri-card__actions">
          <button
            type="button"
            className="gc-ri-card__replay"
            data-testid={`gc-ri-replay-${step.nodeId}`}
            onClick={() => onReplay(step.nodeId)}
          >
            {t("app.runInspector.replayFromHere")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
