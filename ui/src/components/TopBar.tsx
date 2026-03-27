// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";

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
  onStopRun?: () => void;
  runActive?: boolean;
  runStartDisabled?: boolean;
  runDesktopOnlyHint?: boolean;
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
  onStopRun = () => {},
  runActive = false,
  runStartDisabled = false,
  runDesktopOnlyHint = false,
}: Props) {
  const { t, i18n } = useTranslation();

  return (
    <header className="gc-top">
      <span className="gc-top-title">{t("app.title")}</span>
      <div className="gc-top-menu">
        <span className="gc-top-menu-label">{t("app.menu.file")}</span>
        <button type="button" className="gc-btn" onClick={onNewGraph} disabled={runActive}>
          {t("app.menu.new")}
        </button>
        <button type="button" className="gc-btn" onClick={onOpenGraph} disabled={runActive}>
          {t("app.menu.open")}
        </button>
        <button type="button" className="gc-btn gc-btn-primary" onClick={onSaveGraph} disabled={runActive}>
          {t("app.menu.save")}
        </button>
        <span className="gc-top-menu-label">{t("app.menu.edit")}</span>
        <button
          type="button"
          className="gc-btn"
          onClick={onUndo}
          disabled={runActive || !canUndo}
          title={t("app.edit.undoHint")}
        >
          {t("app.edit.undo")}
        </button>
        <button
          type="button"
          className="gc-btn"
          onClick={onRedo}
          disabled={runActive || !canRedo}
          title={t("app.edit.redoHint")}
        >
          {t("app.edit.redo")}
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
        <button type="button" className="gc-btn" onClick={onLinkWorkspace} disabled={runActive}>
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
          disabled={runActive || !workspaceLinked || workspaceGraphOptions.length === 0}
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
            <span className="gc-top-run-label">{t("app.run.heading")}</span>
            <input
              type="text"
              className="gc-top-run-input"
              value={runGraphsDir}
              onChange={(ev) => {
                onRunGraphsDirChange(ev.target.value);
              }}
              placeholder={t("app.run.graphsDirPlaceholder")}
              disabled={runActive}
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
              disabled={runActive}
              spellCheck={false}
              autoComplete="off"
              aria-label={t("app.run.artifactsPlaceholder")}
            />
            <button
              type="button"
              className="gc-btn gc-btn-primary"
              onClick={onRun}
              disabled={runStartDisabled || runActive || runDesktopOnlyHint}
            >
              {t("app.run.start")}
            </button>
            <button type="button" className="gc-btn" onClick={onStopRun} disabled={!runActive}>
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
