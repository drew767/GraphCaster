// Copyright Aura. All Rights Reserved.

import { useTranslation } from "react-i18next";

type Props = {
  heightPx: number;
  onResizeStart: () => void;
};

export function ConsolePanel({ heightPx, onResizeStart }: Props) {
  const { t } = useTranslation();

  return (
    <>
      <div
        className="gc-splitter"
        role="separator"
        aria-orientation="horizontal"
        onMouseDown={onResizeStart}
      />
      <footer className="gc-console" style={{ height: heightPx }}>
        <div className="gc-console-header">{t("app.console.heading")}</div>
        <div className="gc-console-line">{t("app.console.stub")}</div>
      </footer>
    </>
  );
}
