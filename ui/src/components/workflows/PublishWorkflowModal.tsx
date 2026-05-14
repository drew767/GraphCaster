// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { useUIStore } from "../../app/stores/uiStore";
import { useToast } from "../../toast/ToastProvider";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PUBLISH_WORKFLOW_MODAL_KEY = "workflow-publish";

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

interface PublishPayload {
  graphId: string;
}

async function publishWorkflow(
  graphId: string,
  message: string,
  author: string,
): Promise<{ version: number }> {
  const resp = await fetch(`/api/v1/graphs/${graphId}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: message || undefined, author: author || undefined }),
  });
  if (resp.status === 404) {
    const err = new Error("not_found");
    err.name = "NotFound";
    throw err;
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<{ version: number }>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PublishWorkflowModal() {
  const { t } = useTranslation();
  const open = useUIStore((s) => s.isModalOpen(PUBLISH_WORKFLOW_MODAL_KEY));
  const payload = useUIStore((s) => s.getModalPayload<PublishPayload>(PUBLISH_WORKFLOW_MODAL_KEY));
  const closeModal = useUIStore((s) => s.closeModal);
  const { toast } = useToast();

  const [message, setMessage] = useState("");
  const [author, setAuthor] = useState("");
  const [publishing, setPublishing] = useState(false);
  const publishingRef = useRef(false);

  useEffect(() => {
    if (open) {
      setMessage("");
      setAuthor("");
    }
  }, [open]);

  const handleClose = useCallback(() => {
    if (publishingRef.current) return;
    closeModal(PUBLISH_WORKFLOW_MODAL_KEY);
  }, [closeModal]);

  const onBackdropClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) handleClose();
    },
    [handleClose],
  );

  const handlePublish = useCallback(async () => {
    if (publishingRef.current || !payload?.graphId) return;
    publishingRef.current = true;
    setPublishing(true);
    try {
      const result = await publishWorkflow(payload.graphId, message, author);
      toast.success(t("app.workflows.versioning.publishSuccess", { version: result.version }));
      closeModal(PUBLISH_WORKFLOW_MODAL_KEY);
    } catch (e) {
      if (e instanceof Error && e.name === "NotFound") {
        toast.warning(t("app.workflows.versioning.publishNotFound"));
        closeModal(PUBLISH_WORKFLOW_MODAL_KEY);
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(t("app.workflows.versioning.publishError", { error: msg }));
      }
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  }, [payload?.graphId, message, author, toast, t, closeModal]);

  if (!open) return null;

  return (
    <div
      className="gc-modal-backdrop"
      role="presentation"
      onClick={onBackdropClick}
    >
      <div
        className="gc-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gc-publish-modal-title"
        aria-busy={publishing}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="gc-publish-modal-title" className="gc-modal-title">
          {t("app.workflows.versioning.publishTitle")}
        </h2>

        <div className="gc-publish-modal">
          <label className="gc-publish-modal__label" htmlFor="gc-publish-message">
            {t("app.workflows.versioning.publishMessage")}
          </label>
          <textarea
            id="gc-publish-message"
            className="gc-publish-modal__textarea"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("app.workflows.versioning.publishMessagePlaceholder")}
            rows={3}
            disabled={publishing}
            data-testid="publish-message-input"
          />

          <label className="gc-publish-modal__label" htmlFor="gc-publish-author">
            {t("app.workflows.versioning.publishAuthor")}
            <span className="gc-publish-modal__optional">
              {" "}({t("app.workflows.versioning.optional")})
            </span>
          </label>
          <input
            id="gc-publish-author"
            type="text"
            className="gc-publish-modal__input"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder={t("app.workflows.versioning.publishAuthorPlaceholder")}
            disabled={publishing}
            data-testid="publish-author-input"
          />
        </div>

        <div className="gc-modal-actions">
          <button
            type="button"
            className="gc-btn"
            disabled={publishing}
            onClick={handleClose}
          >
            {t("app.workflows.versioning.cancel")}
          </button>
          <button
            type="button"
            className="gc-btn gc-btn-primary"
            disabled={publishing}
            onClick={() => void handlePublish()}
            data-testid="publish-confirm-btn"
          >
            {publishing
              ? t("app.workflows.versioning.publishing", "Publishing…")
              : t("app.workflows.versioning.publishButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
