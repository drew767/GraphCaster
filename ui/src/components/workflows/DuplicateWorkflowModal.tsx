// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { workflowsApi } from "../../lib/workflowsApi";

export interface Project {
  id: string;
  name: string;
}

export interface DuplicateWorkflowModalProps {
  open: boolean;
  workflowId: string | null;
  originalName: string;
  projects?: Project[];
  defaultProjectId?: string;
  initialTags?: string[];
  onClose: () => void;
  onDuplicated?: (result: { id: string; name: string }) => void;
  api?: typeof workflowsApi;
}

export function DuplicateWorkflowModal(props: DuplicateWorkflowModalProps) {
  const {
    open,
    workflowId,
    originalName,
    projects = [],
    defaultProjectId,
    initialTags = [],
    onClose,
    onDuplicated,
    api,
  } = props;
  const { t } = useTranslation();
  const [name, setName] = useState<string>("");
  const [projectId, setProjectId] = useState<string | undefined>(defaultProjectId);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [tagDraft, setTagDraft] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(`${originalName} ${t("duplicateWorkflow.copySuffix")}`.trim());
      setProjectId(defaultProjectId);
      setTags(initialTags);
      setTagDraft("");
    }
  }, [open, originalName, defaultProjectId, initialTags, t]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !workflowId) return null;

  const onBackdrop = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const addTag = () => {
    const v = tagDraft.trim();
    if (!v) return;
    setTags((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setTagDraft("");
  };

  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((x) => x !== tag));
  };

  const onSubmit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const result = await (api ?? workflowsApi).duplicate(workflowId, {
        name: name.trim(),
        projectId,
        tags,
      });
      onDuplicated?.(result);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="gc-modal-backdrop" role="presentation" onClick={onBackdrop}>
      <div
        className="gc-modal gc-duplicate-workflow-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gc-duplicate-workflow-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="gc-duplicate-workflow-title" className="gc-modal-title">
          {t("duplicateWorkflow.title")}
        </h2>
        <div className="gc-form">
          <label className="gc-field">
            <span>{t("duplicateWorkflow.name")}</span>
            <input
              type="text"
              className="gc-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="gc-duplicate-name"
            />
          </label>
          {projects.length > 0 ? (
            <label className="gc-field">
              <span>{t("duplicateWorkflow.project")}</span>
              <select
                className="gc-select"
                value={projectId ?? ""}
                onChange={(e) => setProjectId(e.target.value || undefined)}
              >
                <option value="">{t("duplicateWorkflow.projectNone")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="gc-field">
            <span>{t("duplicateWorkflow.tags")}</span>
            <div className="gc-chips">
              {tags.map((tag) => (
                <span key={tag} className="gc-chip">
                  {tag}
                  <button
                    type="button"
                    className="gc-chip__remove"
                    aria-label={t("duplicateWorkflow.removeTag")}
                    onClick={() => removeTag(tag)}
                  >
                    {"×"}
                  </button>
                </span>
              ))}
            </div>
            <div className="gc-row">
              <input
                type="text"
                className="gc-input"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder={t("duplicateWorkflow.tagPlaceholder")}
              />
              <button type="button" className="gc-btn gc-btn-small" onClick={addTag}>
                {t("duplicateWorkflow.addTag")}
              </button>
            </div>
          </div>
        </div>
        <div className="gc-modal-actions">
          <button type="button" className="gc-btn" onClick={onClose} disabled={submitting}>
            {t("duplicateWorkflow.cancel")}
          </button>
          <button
            type="button"
            className="gc-btn gc-btn-primary"
            onClick={onSubmit}
            disabled={submitting || !name.trim()}
          >
            {t("duplicateWorkflow.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
