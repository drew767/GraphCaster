// Copyright GraphCaster. All Rights Reserved.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PausedRunItem } from "./types";

interface HumanInputModalProps {
  item: PausedRunItem;
  apiBase?: string;
  onClose: () => void;
  onSubmitted: () => void;
}

export function HumanInputModal({
  item,
  apiBase = "/api/v1",
  onClose,
  onSubmitted,
}: HumanInputModalProps) {
  const { t } = useTranslation();
  const [textValue, setTextValue] = useState("");
  const [choiceValue, setChoiceValue] = useState<string | null>(null);
  const [jsonValue, setJsonValue] = useState("");
  const [respondedBy, setRespondedBy] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(approved?: boolean) {
    setSubmitting(true);
    setSubmitError(null);

    let payload: unknown;
    if (item.kind === "text") {
      payload = textValue;
    } else if (item.kind === "choice") {
      payload = choiceValue;
    } else if (item.kind === "approval") {
      payload = approved ?? true;
    } else if (item.kind === "json") {
      try {
        payload = JSON.parse(jsonValue);
      } catch {
        setSubmitError("Invalid JSON");
        setSubmitting(false);
        return;
      }
    } else {
      payload = textValue;
    }

    try {
      const res = await fetch(`${apiBase}/runs/${item.runId}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: item.pausedAtNode,
          payload,
          respondedBy: respondedBy || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onSubmitted();
      onClose();
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("app.pausedRuns.title")}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "#1e1e1e",
          border: "1px solid #444",
          borderRadius: 8,
          padding: 24,
          minWidth: 340,
          maxWidth: 540,
          width: "90%",
          color: "#e0e0e0",
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 16 }}>
          {t("app.pausedRuns.title")}
        </h3>

        <p style={{ marginBottom: 16, fontSize: 14, color: "#bbb" }}>
          <strong>{t("app.pausedRuns.prompt")}:</strong> {item.prompt}
        </p>

        {item.kind === "text" && (
          <textarea
            aria-label="text-input"
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            placeholder={t("app.pausedRuns.textPlaceholder")}
            rows={4}
            style={{ width: "100%", boxSizing: "border-box", marginBottom: 12 }}
          />
        )}

        {item.kind === "choice" && item.choices && (
          <div style={{ marginBottom: 12 }}>
            {item.choices.map((c) => (
              <label key={c} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <input
                  type="radio"
                  name="human-choice"
                  value={c}
                  checked={choiceValue === c}
                  onChange={() => setChoiceValue(c)}
                />
                {c}
              </label>
            ))}
          </div>
        )}

        {item.kind === "json" && (
          <textarea
            aria-label="json-input"
            value={jsonValue}
            onChange={(e) => setJsonValue(e.target.value)}
            placeholder={t("app.pausedRuns.jsonPlaceholder")}
            rows={6}
            style={{
              width: "100%",
              boxSizing: "border-box",
              marginBottom: 12,
              fontFamily: "monospace",
            }}
          />
        )}

        <input
          type="text"
          placeholder={t("app.pausedRuns.respondedByPlaceholder")}
          value={respondedBy}
          onChange={(e) => setRespondedBy(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", marginBottom: 16 }}
        />

        {submitError && (
          <p style={{ color: "#f66", marginBottom: 12, fontSize: 13 }}>
            {t("app.pausedRuns.errorSubmit")}: {submitError}
          </p>
        )}

        {item.kind === "approval" ? (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              disabled={submitting}
              onClick={() => void handleSubmit(true)}
              style={{ flex: 1, padding: "8px 0", cursor: "pointer" }}
            >
              {t("app.pausedRuns.submitApprove")}
            </button>
            <button
              disabled={submitting}
              onClick={() => void handleSubmit(false)}
              style={{ flex: 1, padding: "8px 0", cursor: "pointer" }}
            >
              {t("app.pausedRuns.submitReject")}
            </button>
          </div>
        ) : (
          <button
            disabled={submitting || (item.kind === "choice" && choiceValue == null)}
            onClick={() => void handleSubmit()}
            style={{ width: "100%", padding: "8px 0", cursor: "pointer" }}
          >
            {submitting ? t("app.pausedRuns.loading") : t("app.pausedRuns.submitText")}
          </button>
        )}
      </div>
    </div>
  );
}
