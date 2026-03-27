// Copyright Aura. All Rights Reserved.

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
  workspaceLinked: boolean;
  onLinkWorkspace: () => void;
  workspaceGraphOptions: WorkspaceGraphOption[];
  onOpenWorkspaceGraph: (fileName: string) => void;
};

export function TopBar({
  onLangChange,
  onNewGraph,
  onOpenGraph,
  onSaveGraph,
  workspaceLinked,
  onLinkWorkspace,
  workspaceGraphOptions,
  onOpenWorkspaceGraph,
}: Props) {
  const { t, i18n } = useTranslation();

  return (
    <header className="gc-top">
      <span className="gc-top-title">{t("app.title")}</span>
      <div className="gc-top-menu">
        <span className="gc-top-menu-label">{t("app.menu.file")}</span>
        <button type="button" className="gc-btn" onClick={onNewGraph}>
          {t("app.menu.new")}
        </button>
        <button type="button" className="gc-btn" onClick={onOpenGraph}>
          {t("app.menu.open")}
        </button>
        <button type="button" className="gc-btn gc-btn-primary" onClick={onSaveGraph}>
          {t("app.menu.save")}
        </button>
        <button type="button" className="gc-btn" onClick={onLinkWorkspace}>
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
          disabled={!workspaceLinked || workspaceGraphOptions.length === 0}
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
      </div>
      <div className="gc-top-actions">
        <button
          type="button"
          className="gc-btn"
          aria-pressed={i18n.language.startsWith("en")}
          onClick={() => onLangChange("en")}
        >
          {t("app.lang.en")}
        </button>
        <button
          type="button"
          className="gc-btn"
          aria-pressed={i18n.language.startsWith("ru")}
          onClick={() => onLangChange("ru")}
        >
          {t("app.lang.ru")}
        </button>
      </div>
    </header>
  );
}
