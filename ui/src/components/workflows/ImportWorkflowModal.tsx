// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useMemo, useState, type ChangeEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { templatesApi } from "../../lib/templatesApi";
import { detectImportFormat, parseCurl, type ImportFormat } from "../../utils/curlParser";

export interface ImportResult {
  source: ImportFormat;
  workflow: Record<string, unknown>;
}

export interface ImportWorkflowModalProps {
  open: boolean;
  onClose: () => void;
  onImport?: (result: ImportResult) => void;
  templates?: typeof templatesApi;
}

function buildHttpRequestWorkflow(curlText: string): Record<string, unknown> {
  const parsed = parseCurl(curlText);
  return {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 80, y: 120 },
        data: {},
      },
      {
        id: "http_request_1",
        type: "http_request",
        position: { x: 280, y: 120 },
        data: {
          url: parsed.url,
          method: parsed.method,
          headers: parsed.headers,
          body: parsed.body ?? "",
        },
      },
    ],
    edges: [
      {
        id: "e_start_http",
        source: "start",
        target: "http_request_1",
      },
    ],
  };
}

export function ImportWorkflowModal(props: ImportWorkflowModalProps) {
  const { open, onClose, onImport, templates } = props;
  const { t } = useTranslation();
  const [text, setText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const detection = useMemo(() => detectImportFormat(text), [text]);

  useEffect(() => {
    if (open) {
      setText("");
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onBackdrop = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    setText(content);
  };

  const onSubmit = async () => {
    setError(null);
    setImporting(true);
    try {
      if (detection.format === "json") {
        const parsed = JSON.parse(text.trim()) as Record<string, unknown>;
        onImport?.({ source: "json", workflow: parsed });
        onClose();
        return;
      }
      if (detection.format === "curl") {
        const workflow = buildHttpRequestWorkflow(text);
        onImport?.({ source: "curl", workflow });
        onClose();
        return;
      }
      if (detection.format === "templateUrl" && detection.templateId) {
        const tpl = await (templates ?? templatesApi).get(detection.templateId);
        if (!tpl) {
          setError(t("importWorkflow.templateNotFound"));
          return;
        }
        onImport?.({ source: "templateUrl", workflow: tpl.workflow });
        onClose();
        return;
      }
      setError(t("importWorkflow.unknownFormat"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const formatLabel: Record<ImportFormat, string> = {
    json: t("importWorkflow.detectedJson"),
    curl: t("importWorkflow.detectedCurl"),
    templateUrl: t("importWorkflow.detectedTemplate"),
    unknown: t("importWorkflow.detectedUnknown"),
  };

  return (
    <div className="gc-modal-backdrop" role="presentation" onClick={onBackdrop}>
      <div
        className="gc-modal gc-import-workflow-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gc-import-workflow-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="gc-import-workflow-title" className="gc-modal-title">
          {t("importWorkflow.title")}
        </h2>
        <p className="gc-modal-hint">{t("importWorkflow.hint")}</p>

        <div className="gc-form">
          <label className="gc-field">
            <span>{t("importWorkflow.pasteLabel")}</span>
            <textarea
              className="gc-textarea"
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("importWorkflow.placeholder")}
              data-testid="gc-import-textarea"
            />
          </label>
          <label className="gc-field">
            <span>{t("importWorkflow.fileLabel")}</span>
            <input type="file" accept=".json,.txt,.curl" onChange={onFile} />
          </label>
          <div
            className={`gc-import-detection gc-import-detection--${detection.format}`}
            data-detected={detection.format}
          >
            {t("importWorkflow.detectedPrefix")}: {formatLabel[detection.format]}
          </div>
          {error ? (
            <div className="gc-import-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <div className="gc-modal-actions">
          <button type="button" className="gc-btn" onClick={onClose} disabled={importing}>
            {t("importWorkflow.cancel")}
          </button>
          <button
            type="button"
            className="gc-btn gc-btn-primary"
            onClick={onSubmit}
            disabled={importing || detection.format === "unknown"}
          >
            {t("importWorkflow.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
