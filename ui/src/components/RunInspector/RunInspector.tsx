// Copyright GraphCaster. All Rights Reserved.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useRunSession } from "../../run/runSessionStore";
import { EmptyState } from "../ui/EmptyState/EmptyState";
import { parseRunEventLine } from "../../run/parseRunEventLine";
import { buildTraceTree, type NodeStep, type RunEvent } from "./traceTree";
import { EventTimeline } from "./EventTimeline";
import { EventStream } from "./EventStream";

type Tab = "timeline" | "events" | "errors";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called when user clicks "Replay from here" on a node step card. */
  onReplay?: (nodeId: string) => void;
  /** Called when user clicks a node id to center it on the canvas. */
  onNavigateToNode?: (nodeId: string) => void;
};

export function RunInspector({ open, onClose, onReplay, onNavigateToNode }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("timeline");
  const { consoleLines, activeRunId, focusedRunId, replaySourceLabel } = useRunSession();

  const runId = focusedRunId ?? activeRunId;
  const isLive = runId != null && replaySourceLabel == null;

  const events = useMemo<RunEvent[]>(() => {
    const out: RunEvent[] = [];
    for (const line of consoleLines) {
      const parsed = parseRunEventLine(line);
      if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
        out.push(parsed as RunEvent);
      }
    }
    return out;
  }, [consoleLines]);

  const steps = useMemo<NodeStep[]>(() => buildTraceTree(events), [events]);

  const errorSteps = useMemo<NodeStep[]>(
    () => steps.filter((s) => s.status === "error" || s.error != null),
    [steps],
  );

  const runStartEvent = useMemo(
    () => events.find((e) => e.type === "run_started"),
    [events],
  );

  const totalTokens = useMemo(() => {
    let sum = 0;
    for (const s of steps) {
      if (s.llm) sum += s.llm.tokens;
    }
    return sum;
  }, [steps]);

  const runStatus = useMemo(() => {
    if (isLive) return "running";
    const finEv = events.findLast?.((e) => e.type === "run_finished") ?? null;
    if (finEv == null) return "unknown";
    return String(finEv.status ?? "unknown");
  }, [events, isLive]);

  const displayRunId =
    runId ?? (runStartEvent != null ? String(runStartEvent.runId ?? "") : null) ?? "";

  const totalDurationMs = useMemo(() => {
    if (steps.length === 0) return null;
    const starts = steps.map((s) => s.startedAt).filter((v) => v > 0);
    const ends = steps.map((s) => s.endedAt).filter((v): v is number => v != null);
    if (starts.length === 0 || ends.length === 0) return null;
    return Math.max(...ends) - Math.min(...starts);
  }, [steps]);

  if (!open) return null;

  return (
    <aside
      className="gc-run-inspector"
      aria-label={t("app.runInspector.title")}
      data-testid="gc-run-inspector"
    >
      <div className="gc-run-inspector__header">
        <span className="gc-run-inspector__title">{t("app.runInspector.title")}</span>
        <button
          type="button"
          className="gc-run-inspector__close"
          aria-label="Close run inspector"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="gc-run-inspector__meta">
        {displayRunId !== "" ? (
          <span className="gc-ri-meta__run-id" title={displayRunId}>
            {displayRunId.length > 20 ? `…${displayRunId.slice(-20)}` : displayRunId}
          </span>
        ) : null}
        <span
          className={`gc-ri-badge gc-ri-badge--status-${runStatus}`}
          data-testid="gc-ri-run-status"
        >
          {runStatus}
        </span>
        {totalDurationMs != null ? (
          <span className="gc-ri-meta__duration" data-testid="gc-ri-total-duration">
            {formatDuration(totalDurationMs)}
          </span>
        ) : null}
        {totalTokens > 0 ? (
          <span className="gc-ri-meta__tokens" data-testid="gc-ri-total-tokens">
            {totalTokens} tokens
          </span>
        ) : null}
      </div>

      <div className="gc-run-inspector__tabs" role="tablist" aria-label={t("app.runInspector.tabsAria")}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "timeline"}
          className={`gc-ri-tab${tab === "timeline" ? " gc-ri-tab--active" : ""}`}
          onClick={() => setTab("timeline")}
          data-testid="gc-ri-tab-timeline"
        >
          {t("app.runInspector.tabTimeline")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "events"}
          className={`gc-ri-tab${tab === "events" ? " gc-ri-tab--active" : ""}`}
          onClick={() => setTab("events")}
          data-testid="gc-ri-tab-events"
        >
          {t("app.runInspector.tabEvents")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "errors"}
          className={`gc-ri-tab${tab === "errors" ? " gc-ri-tab--active" : ""}`}
          onClick={() => setTab("errors")}
          data-testid="gc-ri-tab-errors"
        >
          {t("app.runInspector.tabErrors")}
          {errorSteps.length > 0 ? (
            <span className="gc-ri-tab__badge">{errorSteps.length}</span>
          ) : null}
        </button>
      </div>

      <div className="gc-run-inspector__body">
        {tab === "timeline" ? (
          steps.length === 0 && !isLive ? (
            <EmptyState
              icon="circle-play"
              title={t("app.empty.runInspector.title")}
              description={t("app.empty.runInspector.description")}
              size="small"
            />
          ) : (
            <EventTimeline
              steps={steps}
              onReplay={onReplay}
              onNavigateToNode={onNavigateToNode}
            />
          )
        ) : tab === "events" ? (
          <EventStream events={events} />
        ) : (
          <div data-testid="gc-ri-errors-tab">
            {errorSteps.length === 0 ? (
              <div className="gc-ri-empty">{t("app.runInspector.noErrors")}</div>
            ) : (
              <EventTimeline
                steps={errorSteps}
                onReplay={onReplay}
                onNavigateToNode={onNavigateToNode}
              />
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}
