// Copyright GraphCaster. All Rights Reserved.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { HumanInputModal } from "./HumanInputModal";
import { usePausedRuns } from "./usePausedRuns";
import type { PausedRunItem } from "./types";

interface PausedRunsBadgeProps {
  apiBase?: string;
}

export function PausedRunsBadge({ apiBase = "/api/v1" }: PausedRunsBadgeProps) {
  const { t } = useTranslation();
  const { items, loading, error, refresh } = usePausedRuns(apiBase);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PausedRunItem | null>(null);

  const count = items.length;

  if (count === 0 && !loading) {
    return null;
  }

  return (
    <>
      <button
        aria-label={`${t("app.pausedRuns.badge")} (${count})`}
        title={t("app.pausedRuns.badge")}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 8px",
          borderRadius: 4,
          background: "#b45309",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        <span aria-hidden="true">⏸</span>
        <span data-testid="paused-count">{count}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            top: 48,
            right: 12,
            zIndex: 9998,
            background: "#1e1e1e",
            border: "1px solid #444",
            borderRadius: 8,
            padding: 16,
            minWidth: 280,
            maxWidth: 380,
            boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
            color: "#e0e0e0",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <strong style={{ fontSize: 14 }}>{t("app.pausedRuns.title")}</strong>
            <button
              onClick={() => setOpen(false)}
              aria-label="close"
              style={{ background: "none", border: "none", color: "#aaa", cursor: "pointer" }}
            >
              ✕
            </button>
          </div>

          {loading && <p style={{ fontSize: 13, color: "#aaa" }}>{t("app.pausedRuns.loading")}</p>}
          {error && (
            <p style={{ fontSize: 13, color: "#f66" }}>
              {t("app.pausedRuns.errorLoad")}: {error}
            </p>
          )}

          {!loading && items.length === 0 && (
            <p style={{ fontSize: 13, color: "#aaa" }}>{t("app.pausedRuns.noRuns")}</p>
          )}

          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {items.map((item) => (
              <li
                key={item.runId}
                style={{ marginBottom: 8, borderBottom: "1px solid #333", paddingBottom: 8 }}
              >
                <p style={{ margin: "0 0 4px", fontSize: 12, color: "#aaa" }}>
                  {item.graphId} — {item.pausedAtNode}
                </p>
                <p style={{ margin: "0 0 6px", fontSize: 13 }}>{item.prompt}</p>
                <button
                  onClick={() => {
                    setSelected(item);
                    setOpen(false);
                  }}
                  style={{
                    fontSize: 12,
                    padding: "4px 10px",
                    cursor: "pointer",
                    background: "#1d4ed8",
                    color: "#fff",
                    border: "none",
                    borderRadius: 4,
                  }}
                >
                  {t("app.pausedRuns.submitText")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {selected != null && (
        <HumanInputModal
          item={selected}
          apiBase={apiBase}
          onClose={() => setSelected(null)}
          onSubmitted={() => {
            setSelected(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
