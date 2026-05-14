// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { workflowsApi } from "../../lib/workflowsApi";

export interface FolderNode {
  id: string;
  name: string;
  children?: FolderNode[];
}

export interface ProjectNode {
  id: string;
  name: string;
  folders?: FolderNode[];
}

export interface MoveWorkflowModalProps {
  open: boolean;
  workflowId: string | null;
  projects: ProjectNode[];
  onClose: () => void;
  onMoved?: () => void;
  api?: typeof workflowsApi;
}

interface Selection {
  projectId: string;
  folderId: string | null;
}

function FolderTree({
  nodes,
  selection,
  projectId,
  onSelect,
  depth,
}: {
  nodes: FolderNode[];
  selection: Selection | null;
  projectId: string;
  onSelect: (sel: Selection) => void;
  depth: number;
}) {
  return (
    <ul className="gc-tree" role="group">
      {nodes.map((node) => {
        const selected =
          selection?.projectId === projectId && selection?.folderId === node.id;
        return (
          <li key={node.id} className="gc-tree__node">
            <button
              type="button"
              role="treeitem"
              aria-selected={selected}
              className={`gc-tree__row ${selected ? "gc-tree__row--selected" : ""}`}
              style={{ paddingLeft: `${depth * 12}px` }}
              onClick={() => onSelect({ projectId, folderId: node.id })}
              data-folder-id={node.id}
            >
              {node.name}
            </button>
            {node.children && node.children.length > 0 ? (
              <FolderTree
                nodes={node.children}
                selection={selection}
                projectId={projectId}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function MoveWorkflowModal(props: MoveWorkflowModalProps) {
  const { open, workflowId, projects, onClose, onMoved, api } = props;
  const { t } = useTranslation();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSelection(null);
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

  if (!open || !workflowId) return null;

  const onBackdrop = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const onSubmit = async () => {
    if (!selection) return;
    setSubmitting(true);
    try {
      await (api ?? workflowsApi).move(workflowId, {
        projectId: selection.projectId,
        folderId: selection.folderId,
      });
      onMoved?.();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="gc-modal-backdrop" role="presentation" onClick={onBackdrop}>
      <div
        className="gc-modal gc-move-workflow-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gc-move-workflow-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="gc-move-workflow-title" className="gc-modal-title">
          {t("moveWorkflow.title")}
        </h2>
        <p className="gc-modal-hint">{t("moveWorkflow.hint")}</p>
        <div className="gc-tree-host" role="tree" aria-label={t("moveWorkflow.treeAria")}>
          {projects.length === 0 ? (
            <p className="gc-empty">{t("moveWorkflow.empty")}</p>
          ) : (
            projects.map((project) => {
              const selected =
                selection?.projectId === project.id && selection?.folderId === null;
              return (
                <div key={project.id} className="gc-tree__project">
                  <button
                    type="button"
                    role="treeitem"
                    aria-selected={selected}
                    className={`gc-tree__row gc-tree__row--project ${
                      selected ? "gc-tree__row--selected" : ""
                    }`}
                    onClick={() =>
                      setSelection({ projectId: project.id, folderId: null })
                    }
                    data-project-id={project.id}
                  >
                    {project.name}
                  </button>
                  {project.folders && project.folders.length > 0 ? (
                    <FolderTree
                      nodes={project.folders}
                      selection={selection}
                      projectId={project.id}
                      onSelect={setSelection}
                      depth={1}
                    />
                  ) : null}
                </div>
              );
            })
          )}
        </div>
        <div className="gc-modal-actions">
          <button type="button" className="gc-btn" onClick={onClose} disabled={submitting}>
            {t("moveWorkflow.cancel")}
          </button>
          <button
            type="button"
            className="gc-btn gc-btn-primary"
            onClick={onSubmit}
            disabled={submitting || !selection}
          >
            {t("moveWorkflow.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
