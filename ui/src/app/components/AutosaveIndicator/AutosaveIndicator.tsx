// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatRelative } from "../../../lib/time";
import { useAutosaveStore } from "../../stores/autosaveStore";

import "./AutosaveIndicator.css";

export interface AutosaveIndicatorProps {
  workflowId: string;
  /** Polling interval to refresh the relative label (default 15s). */
  refreshIntervalMs?: number;
  /** Inject a clock for tests. */
  now?: () => number;
}

/**
 * Renders "Saved Ns ago" / "Failed to save (retry)" in the workflow header.
 * Reads `lastSaved` / `error` from the autosave store.
 */
export function AutosaveIndicator({
  workflowId,
  refreshIntervalMs = 15_000,
  now,
}: AutosaveIndicatorProps) {
  const { t } = useTranslation();
  const entry = useAutosaveStore((s) => s.byWorkflow[workflowId]);
  const retry = useAutosaveStore((s) => s.retry);

  // Tick to refresh the relative label.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!entry?.lastSaved) return;
    const id = setInterval(() => setTick((n) => n + 1), refreshIntervalMs);
    return () => clearInterval(id);
  }, [entry?.lastSaved, refreshIntervalMs]);

  if (!entry) {
    return null;
  }

  if (entry.error) {
    return (
      <button
        type="button"
        className="gc-autosave-indicator gc-autosave-indicator--error"
        data-testid="autosave-indicator"
        data-state="error"
        onClick={() => retry(workflowId)}
        title={entry.error.message}
      >
        {t("autosave.failed", "Failed to save (retry)")}
      </button>
    );
  }

  if (entry.saving) {
    return (
      <span
        className="gc-autosave-indicator gc-autosave-indicator--saving"
        data-testid="autosave-indicator"
        data-state="saving"
      >
        {t("autosave.saving", "Saving…")}
      </span>
    );
  }

  if (entry.lastSaved) {
    const justNow = t("autosave.justNow", "just now");
    const rel = formatRelative(entry.lastSaved, {
      justNow,
      now: now ? now() : undefined,
    });
    return (
      <span
        className="gc-autosave-indicator"
        data-testid="autosave-indicator"
        data-state="saved"
      >
        {t("autosave.savedRel", "Saved {{rel}}", { rel })}
      </span>
    );
  }

  return null;
}
