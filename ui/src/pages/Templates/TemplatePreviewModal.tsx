// Copyright GraphCaster. All Rights Reserved.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TemplateMeta } from "../../api/templates";

interface WorkflowGraphLike {
  nodes?: Array<{
    id?: string;
    type?: string;
    data?: { label?: string; description?: string; icon?: string };
    position?: { x: number; y: number };
  }>;
  edges?: Array<{ id?: string; source?: string; target?: string }>;
}

interface NodeEntry {
  type: string;
  label: string;
  description?: string;
}

function collectNodeEntries(template: TemplateMeta): NodeEntry[] {
  const wf = (template.workflow ?? {}) as WorkflowGraphLike;
  const wfNodes = Array.isArray(wf.nodes) ? wf.nodes : [];
  if (wfNodes.length > 0) {
    return wfNodes.map((n, idx) => ({
      type: n.type ?? `node-${idx}`,
      label: n.data?.label ?? n.type ?? `node-${idx}`,
      description: n.data?.description,
    }));
  }
  return template.nodes.map((type) => ({ type, label: type }));
}

function hubUrl(template: TemplateMeta): string {
  return `https://templates.n8n.io/${encodeURIComponent(template.id)}`;
}

interface TemplatePreviewModalProps {
  template: TemplateMeta;
  onClose: () => void;
  onUse: (template: TemplateMeta) => void | Promise<void>;
}

export function TemplatePreviewModal({
  template,
  onClose,
  onUse,
}: TemplatePreviewModalProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nodeEntries = collectNodeEntries(template);

  async function handleUse() {
    setBusy(true);
    setError(null);
    try {
      await onUse(template);
    } catch {
      setError(t("templates.useError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="gc-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gc-template-preview-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="gc-modal gc-template-preview-modal">
        <div className="gc-modal__header gc-template-preview-modal__header">
          <div className="gc-template-preview-modal__heading">
            <h2 id="gc-template-preview-title" className="gc-modal__title">
              {template.name}
            </h2>
            <div className="gc-template-preview-modal__author">
              {template.author.avatarUrl ? (
                <img
                  src={template.author.avatarUrl}
                  alt=""
                  className="gc-template-preview-modal__avatar"
                />
              ) : (
                <span
                  className="gc-template-preview-modal__avatar gc-template-preview-modal__avatar--placeholder"
                  aria-hidden="true"
                >
                  {template.author.name.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="gc-template-preview-modal__author-name">
                {template.author.name}
              </span>
              <span className="gc-template-preview-modal__uses">
                {t("templates.usesCount", { count: template.views })}
              </span>
            </div>
          </div>
          <button
            className="gc-modal__close"
            onClick={onClose}
            aria-label={t("templates.close")}
            type="button"
          >
            &times;
          </button>
        </div>

        <div className="gc-modal__body gc-template-preview-modal__body">
          <div className="gc-template-preview-modal__canvas" aria-label={t("templates.canvasPreview")}>
            {template.coverUrl ? (
              <img
                src={template.coverUrl}
                alt={template.name}
                className="gc-template-preview-modal__img"
              />
            ) : (
              <div className="gc-template-preview-modal__placeholder" aria-hidden="true">
                {template.name}
              </div>
            )}
            <p className="gc-template-preview-modal__description">
              {template.description}
            </p>
          </div>

          <div className="gc-template-preview-modal__nodes" data-testid="preview-node-list">
            <h3 className="gc-template-preview-modal__nodes-title">
              {t("templates.nodesInTemplate", { count: nodeEntries.length })}
            </h3>
            <ul role="list" className="gc-template-preview-modal__nodes-list">
              {nodeEntries.map((node, idx) => (
                <li key={`${node.type}-${idx}`} className="gc-template-preview-modal__node-item">
                  <span className="gc-template-preview-modal__node-icon" aria-hidden="true">
                    {node.label.charAt(0).toUpperCase()}
                  </span>
                  <div className="gc-template-preview-modal__node-text">
                    <span className="gc-template-preview-modal__node-name">{node.label}</span>
                    {node.description && (
                      <span className="gc-template-preview-modal__node-desc">
                        {node.description}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {error && (
          <p className="gc-template-preview-modal__error" role="alert">
            {error}
          </p>
        )}

        <div className="gc-modal__footer">
          <a
            className="gc-modal__btn gc-modal__btn--link"
            href={hubUrl(template)}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t("templates.viewOnHub")}
          </a>
          <button
            className="gc-modal__btn gc-modal__btn--secondary"
            onClick={onClose}
            type="button"
            disabled={busy}
          >
            {t("templates.close")}
          </button>
          <button
            className="gc-modal__btn gc-modal__btn--primary"
            onClick={() => void handleUse()}
            type="button"
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? t("templates.using") : t("templates.useTemplate")}
          </button>
        </div>
      </div>
    </div>
  );
}
