// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { runSessionClearConsole, useRunSession } from "../run/runSessionStore";

type Props = {
  heightPx: number;
  onResizeStart: () => void;
};

export function ConsolePanel({ heightPx, onResizeStart }: Props) {
  const { t } = useTranslation();
  const { consoleLines, pythonBanner } = useRunSession();
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [consoleLines.length]);

  return (
    <>
      <div
        className="gc-splitter"
        role="separator"
        aria-orientation="horizontal"
        onMouseDown={onResizeStart}
      />
      <footer className="gc-console" style={{ height: heightPx }}>
        <div className="gc-console-toolbar">
          <div className="gc-console-header">{t("app.console.heading")}</div>
          <div className="gc-console-actions">
            <button type="button" className="gc-btn gc-btn-small" onClick={() => runSessionClearConsole()}>
              {t("app.console.clear")}
            </button>
            <button
              type="button"
              className="gc-btn gc-btn-small"
              disabled={consoleLines.length === 0}
              onClick={() => {
                const blob = new Blob([consoleLines.join("\n")], { type: "text/plain;charset=utf-8" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "graph-caster-run-log.txt";
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              {t("app.console.export")}
            </button>
          </div>
        </div>
        {pythonBanner != null && pythonBanner !== "" ? (
          <div className="gc-run-banner" role="status">
            {pythonBanner}
          </div>
        ) : null}
        <div ref={bodyRef} className="gc-console-body">
          {consoleLines.length === 0 ? (
            <div className="gc-console-line gc-console-line--muted">{t("app.console.empty")}</div>
          ) : (
            consoleLines.map((line, i) => (
              <pre key={`${i}-${line.slice(0, 24)}`} className="gc-console-line">
                {line}
              </pre>
            ))
          )}
        </div>
      </footer>
    </>
  );
}
