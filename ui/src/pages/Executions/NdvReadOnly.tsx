// Copyright GraphCaster. All Rights Reserved.

import { useEffect, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import type { ExecutionNodePayload } from "./executionsApi";
import { statusIconChar, formatDurationMs } from "./executionStatus";

type Props = {
  node: ExecutionNodePayload | null;
  open: boolean;
  onClose: () => void;
};

function stringifySafe(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function NdvReadOnly({ node, open, onClose }: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (ev: KeyboardEvent | globalThis.KeyboardEvent) => {
      if ((ev as globalThis.KeyboardEvent).key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey as (e: globalThis.KeyboardEvent) => void);
    return () => {
      window.removeEventListener("keydown", onKey as (e: globalThis.KeyboardEvent) => void);
    };
  }, [open, onClose]);

  if (!open || !node) {
    return null;
  }

  const inputText = stringifySafe(node.input);
  const outputText = stringifySafe(node.output);
  const paramsText = stringifySafe(node.parameters ?? {});

  return (
    <aside
      className="gc-exec-ndv"
      role="dialog"
      aria-modal="false"
      aria-label={t("executions.detail.ndv.aria")}
      data-testid="gc-exec-ndv"
    >
      <header className="gc-exec-ndv__header">
        <div className="gc-exec-ndv__title">
          <span aria-hidden="true">{statusIconChar(node.status)}</span>
          <span className="gc-exec-ndv__name">{node.name}</span>
        </div>
        <div className="gc-exec-ndv__meta">
          <span>{formatDurationMs(node.durationMs)}</span>
        </div>
        <button
          type="button"
          className="gc-btn"
          onClick={onClose}
          aria-label={t("executions.detail.ndv.close")}
        >
          {t("executions.detail.ndv.close")}
        </button>
      </header>

      {node.error ? (
        <div className="gc-exec-ndv__error" role="alert">
          <strong>{t("executions.detail.ndv.error")}:</strong> {node.error}
        </div>
      ) : null}

      <section className="gc-exec-ndv__section" aria-label={t("executions.detail.ndv.input")}>
        <h3>{t("executions.detail.ndv.input")}</h3>
        <pre className="gc-exec-ndv__pre" data-testid="gc-exec-ndv-input">
          {inputText || t("executions.detail.ndv.empty")}
        </pre>
      </section>

      <section
        className="gc-exec-ndv__section"
        aria-label={t("executions.detail.ndv.parameters")}
      >
        <h3>{t("executions.detail.ndv.parameters")}</h3>
        <pre className="gc-exec-ndv__pre" data-testid="gc-exec-ndv-parameters">
          {paramsText || t("executions.detail.ndv.empty")}
        </pre>
      </section>

      <section className="gc-exec-ndv__section" aria-label={t("executions.detail.ndv.output")}>
        <h3>{t("executions.detail.ndv.output")}</h3>
        <pre className="gc-exec-ndv__pre" data-testid="gc-exec-ndv-output">
          {outputText || t("executions.detail.ndv.empty")}
        </pre>
      </section>
    </aside>
  );
}
