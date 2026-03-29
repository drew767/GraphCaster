// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";

import type { AlignDistributeOp } from "../graph/canvasAlignSelection";

export type WorkspaceGraphOption = {
  fileName: string;
  label: string;
};

type Props = {
  onLangChange: (lng: string) => void;
  onNewGraph: () => void;
  onOpenGraph: () => void;
  onSaveGraph: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  canGroupSelection?: boolean;
  canUngroupSelection?: boolean;
  onGroupSelection?: () => void;
  onUngroupSelection?: () => void;
  snapToGridEnabled?: boolean;
  onSnapToGridChange?: (enabled: boolean) => void;
  ghostOffViewportEnabled?: boolean;
  onGhostOffViewportChange?: (enabled: boolean) => void;
  canAlignSelection?: boolean;
  canDistributeSelection?: boolean;
  onAlignDistribute?: (op: AlignDistributeOp) => void;
  workspaceLinked: boolean;
  onLinkWorkspace: () => void;
  workspaceGraphOptions: WorkspaceGraphOption[];
  onOpenWorkspaceGraph: (fileName: string) => void;
  onOpenFindNode?: () => void;
  showRunControls?: boolean;
  runGraphsDir?: string;
  runArtifactsBase?: string;
  onRunGraphsDirChange?: (value: string) => void;
  onRunArtifactsBaseChange?: (value: string) => void;
  onRun?: () => void;
  onRunHistory?: () => void;
  runHistoryDisabled?: boolean;
  onStopRun?: () => void;
  /** True when runs are live or jobs are queued (locks file/edit, run bar inputs). */
  sessionBlocking?: boolean;
  /** True when at least one child process is running (enables Stop). */
  hasLiveRun?: boolean;
  liveRunIds?: readonly string[];
  focusedRunId?: string | null;
  onFocusedRunChange?: (runId: string) => void;
  pendingRunCount?: number;
  runStartDisabled?: boolean;
  runDesktopOnlyHint?: boolean;
  stepCacheRunEnabled?: boolean;
  onStepCacheRunEnabledChange?: (enabled: boolean) => void;
  hasArtifactsBase?: boolean;
  stepCacheDirtyCount?: number;
};

export function TopBar({
  onLangChange,
  onNewGraph,
  onOpenGraph,
  onSaveGraph,
  canUndo = false,
  canRedo = false,
  onUndo = () => {},
  onRedo = () => {},
  canGroupSelection = false,
  canUngroupSelection = false,
  onGroupSelection = () => {},
  onUngroupSelection = () => {},
  snapToGridEnabled = false,
  onSnapToGridChange = () => {},
  ghostOffViewportEnabled = false,
  onGhostOffViewportChange = () => {},
  canAlignSelection = false,
  canDistributeSelection = false,
  onAlignDistribute = () => {},
  workspaceLinked,
  onLinkWorkspace,
  workspaceGraphOptions,
  onOpenWorkspaceGraph,
  onOpenFindNode = () => {},
  showRunControls = false,
  runGraphsDir = "",
  runArtifactsBase = "",
  onRunGraphsDirChange = () => {},
  onRunArtifactsBaseChange = () => {},
  onRun = () => {},
  onRunHistory = () => {},
  runHistoryDisabled = false,
  onStopRun = () => {},
  sessionBlocking = false,
  hasLiveRun = false,
  liveRunIds = [],
  focusedRunId = null,
  onFocusedRunChange = () => {},
  pendingRunCount = 0,
  runStartDisabled = false,
  runDesktopOnlyHint = false,
  stepCacheRunEnabled = false,
  onStepCacheRunEnabledChange = () => {},
  hasArtifactsBase = false,
  stepCacheDirtyCount = 0,
}: Props) {
  const { t, i18n } = useTranslation();

  return (
    <header className="gc-top">
      <span className="gc-top-title">{t("app.title")}</span>
      <div className="gc-top-menu">
        <span className="gc-top-menu-label">{t("app.menu.file")}</span>
        <button type="button" className="gc-btn" onClick={onNewGraph} disabled={sessionBlocking}>
          {t("app.menu.new")}
        </button>
        <button type="button" className="gc-btn" onClick={onOpenGraph} disabled={sessionBlocking}>
          {t("app.menu.open")}
        </button>
        <button
          type="button"
          className="gc-btn gc-btn-primary"
          onClick={onSaveGraph}
          disabled={sessionBlocking}
        >
          {t("app.menu.save")}
        </button>
        <span className="gc-top-menu-label">{t("app.menu.edit")}</span>
        <button
          type="button"
          className="gc-btn"
          onClick={onUndo}
          disabled={sessionBlocking || !canUndo}
          title={t("app.edit.undoHint")}
        >
          {t("app.edit.undo")}
        </button>
        <button
          type="button"
          className="gc-btn"
          onClick={onRedo}
          disabled={sessionBlocking || !canRedo}
          title={t("app.edit.redoHint")}
        >
          {t("app.edit.redo")}
        </button>
        <button
          type="button"
          className="gc-btn"
          onClick={onGroupSelection}
          disabled={sessionBlocking || !canGroupSelection}
          title={t("app.edit.groupHint")}
        >
          {t("app.edit.group")}
        </button>
        <button
          type="button"
          className="gc-btn"
          onClick={onUngroupSelection}
          disabled={sessionBlocking || !canUngroupSelection}
          title={t("app.edit.ungroupHint")}
        >
          {t("app.edit.ungroup")}
        </button>
        <span className="gc-top-menu-label">{t("app.menu.view")}</span>
        <button
          type="button"
          className="gc-btn"
          onClick={onOpenFindNode}
          title={t("app.canvas.findNodeShortcut")}
        >
          {t("app.canvas.findNode")}
        </button>
        <label className="gc-top-run-stepcache" title={t("app.canvas.snapGridHint")}>
          <input
            type="checkbox"
            checked={snapToGridEnabled}
            disabled={sessionBlocking}
            aria-label={t("app.canvas.snapGrid")}
            onChange={(ev) => {
              onSnapToGridChange(ev.target.checked);
            }}
          />
          <span>{t("app.canvas.snapGrid")}</span>
        </label>
        <label
          className="gc-top-run-stepcache"
          title={t("app.canvas.ghostOffViewportHint")}
        >
          <input
            type="checkbox"
            checked={ghostOffViewportEnabled}
            disabled={sessionBlocking}
            aria-label={t("app.canvas.ghostOffViewport")}
            onChange={(ev) => {
              onGhostOffViewportChange(ev.target.checked);
            }}
          />
          <span>{t("app.canvas.ghostOffViewport")}</span>
        </label>
        <select
          className="gc-workspace-select"
          aria-label={t("app.canvas.alignSelectLabel")}
          disabled={sessionBlocking || !canAlignSelection}
          value=""
          onChange={(ev) => {
            const v = ev.target.value as AlignDistributeOp | "";
            if (v !== "") {
              onAlignDistribute(v);
            }
            ev.currentTarget.value = "";
          }}
        >
          <option value="">{t("app.canvas.alignPlaceholder")}</option>
          <option value="align-left">{t("app.canvas.alignLeft")}</option>
          <option value="align-right">{t("app.canvas.alignRight")}</option>
          <option value="align-top">{t("app.canvas.alignTop")}</option>
          <option value="align-bottom">{t("app.canvas.alignBottom")}</option>
          <option value="align-h-center">{t("app.canvas.alignHCenter")}</option>
          <option value="align-v-center">{t("app.canvas.alignVCenter")}</option>
        </select>
        <select
          className="gc-workspace-select"
          aria-label={t("app.canvas.distributeSelectLabel")}
          disabled={sessionBlocking || !canDistributeSelection}
          value=""
          onChange={(ev) => {
            const v = ev.target.value as AlignDistributeOp | "";
            if (v !== "") {
              onAlignDistribute(v);
            }
            ev.currentTarget.value = "";
          }}
        >
          <option value="">{t("app.canvas.distributePlaceholder")}</option>
          <option value="distribute-h">{t("app.canvas.distributeH")}</option>
          <option value="distribute-v">{t("app.canvas.distributeV")}</option>
        </select>
        <button type="button" className="gc-btn" onClick={onLinkWorkspace} disabled={sessionBlocking}>
          {t("app.workspace.link")}
        </button>
        {workspaceLinked ? (
          <span className="gc-workspace-badge" title={t("app.workspace.linkedHint")}>
            {t("app.workspace.linkedBadge")}
          </span>
        ) : null}
        <select
          className="gc-workspace-select"
          aria-label={t("app.workspace.openFromList")}
          disabled={sessionBlocking || !workspaceLinked || workspaceGraphOptions.length === 0}
          defaultValue=""
          onChange={(ev) => {
            const v = ev.target.value;
            if (v) {
              onOpenWorkspaceGraph(v);
            }
            ev.target.value = "";
          }}
        >
          <option value="">{t("app.workspace.openFromList")}</option>
          {workspaceGraphOptions.map((o) => (
            <option key={o.fileName} value={o.fileName}>
              {o.label}
            </option>
          ))}
        </select>
        {showRunControls ? (
          <div className="gc-top-run" title={runDesktopOnlyHint ? t("app.run.desktopOnlyHint") : undefined}>
            <span className="gc-top-run-label">
              {t("app.run.heading")}
              {pendingRunCount > 0 ? (
                <span
                  className="gc-top-run-stepcache__badge"
                  title={t("app.run.pendingQueueHint", { count: pendingRunCount })}
                >
                  +{pendingRunCount}
                </span>
              ) : null}
            </span>
            {liveRunIds.length > 1 ? (
              <select
                className="gc-workspace-select"
                aria-label={t("app.run.focusRunLabel")}
                value={focusedRunId ?? liveRunIds[0] ?? ""}
                onChange={(ev) => {
                  const v = ev.target.value;
                  if (v) {
                    onFocusedRunChange(v);
                  }
                }}
              >
                {liveRunIds.map((id) => (
                  <option key={id} value={id}>
                    {id.length > 12 ? `${id.slice(0, 8)}…` : id}
                  </option>
                ))}
              </select>
            ) : null}
            <input
              type="text"
              className="gc-top-run-input"
              value={runGraphsDir}
              onChange={(ev) => {
                onRunGraphsDirChange(ev.target.value);
              }}
              placeholder={t("app.run.graphsDirPlaceholder")}
              disabled={sessionBlocking}
              spellCheck={false}
              autoComplete="off"
              aria-label={t("app.run.graphsDirPlaceholder")}
            />
            <input
              type="text"
              className="gc-top-run-input"
              value={runArtifactsBase}
              onChange={(ev) => {
                onRunArtifactsBaseChange(ev.target.value);
              }}
              placeholder={t("app.run.artifactsPlaceholder")}
              disabled={sessionBlocking}
              spellCheck={false}
              autoComplete="off"
              aria-label={t("app.run.artifactsPlaceholder")}
            />
            <label
              className="gc-top-run-stepcache"
              title={
                hasArtifactsBase
                  ? t("app.run.stepCacheHint")
                  : t("app.run.stepCacheNeedArtifactsHint")
              }
            >
              <input
                type="checkbox"
                checked={stepCacheRunEnabled && hasArtifactsBase}
                disabled={sessionBlocking || runDesktopOnlyHint || !hasArtifactsBase}
                aria-label={t("app.run.stepCache")}
                onChange={(ev) => {
                  onStepCacheRunEnabledChange(ev.target.checked);
                }}
              />
              <span>
                {t("app.run.stepCache")}
                {stepCacheDirtyCount > 0 ? (
                  <span className="gc-top-run-stepcache__badge">{stepCacheDirtyCount}</span>
                ) : null}
              </span>
            </label>
            <button
              type="button"
              className="gc-btn gc-btn-primary"
              onClick={onRun}
              disabled={runStartDisabled || runDesktopOnlyHint}
            >
              {t("app.run.start")}
            </button>
            <button
              type="button"
              className="gc-btn"
              onClick={onRunHistory}
              disabled={sessionBlocking || runHistoryDisabled || runDesktopOnlyHint}
              title={runHistoryDisabled ? t("app.runHistory.needArtifactsAndGraph") : undefined}
            >
              {t("app.run.history")}
            </button>
            <button type="button" className="gc-btn" onClick={onStopRun} disabled={!hasLiveRun}>
              {t("app.run.stop")}
            </button>
          </div>
        ) : null}
      </div>
      <div className="gc-top-actions">
        <select
          className="gc-lang-select"
          aria-label={t("app.lang.selectLabel")}
          value={i18n.language.startsWith("ru") ? "ru" : "en"}
          onChange={(ev) => {
            onLangChange(ev.target.value);
          }}
        >
          <option value="en">{t("app.lang.en")}</option>
          <option value="ru">{t("app.lang.ru")}</option>
        </select>
      </div>
    </header>
  );
}
