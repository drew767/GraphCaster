// Copyright GraphCaster. All Rights Reserved.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalShell } from "./ModalShell";
import { useWorkflowsStore } from "./workflowsStore";

interface TagsManagementModalProps {
  open: boolean;
  onClose: () => void;
}

export function TagsManagementModal({ open, onClose }: TagsManagementModalProps): JSX.Element | null {
  const { t } = useTranslation();
  const tags = useWorkflowsStore((s) => s.tags);
  const addTag = useWorkflowsStore((s) => s.addTag);
  const renameTag = useWorkflowsStore((s) => s.renameTag);
  const deleteTag = useWorkflowsStore((s) => s.deleteTag);
  const [newTag, setNewTag] = useState("");
  const [editing, setEditing] = useState<{ name: string; next: string } | null>(null);

  if (!open) return null;

  return (
    <ModalShell title={t("workflows.tagsManage.title")} onClose={onClose} testId="tags-manage-modal">
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <input
          data-testid="tags-manage-new-input"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          placeholder={t("workflows.tagsManage.newPlaceholder")}
          aria-label={t("workflows.tagsManage.newPlaceholder")}
          style={{
            flex: 1,
            padding: "4px 8px",
            border: "1px solid var(--gc-border)",
            borderRadius: "var(--gc-radius-sm)",
            fontSize: 13,
          }}
        />
        <button
          type="button"
          data-testid="tags-manage-add"
          onClick={() => {
            if (newTag.trim()) {
              addTag(newTag.trim());
              setNewTag("");
            }
          }}
          style={{
            padding: "4px 10px",
            border: "1px solid var(--gc-border)",
            borderRadius: "var(--gc-radius-sm)",
            background: "var(--gc-accent)",
            color: "white",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          {t("workflows.tagsManage.add")}
        </button>
      </div>
      {tags.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--gc-text-secondary)" }}>
          {t("workflows.tagsManage.empty")}
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 240, overflow: "auto" }}>
          {tags.map((tag) => {
            const isEditing = editing?.name === tag;
            return (
              <li
                key={tag}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 0",
                  fontSize: 13,
                }}
              >
                {isEditing ? (
                  <>
                    <input
                      data-testid={`tags-manage-rename-${tag}`}
                      value={editing.next}
                      onChange={(e) => setEditing({ name: tag, next: e.target.value })}
                      style={{
                        flex: 1,
                        padding: "3px 6px",
                        border: "1px solid var(--gc-border)",
                        borderRadius: "var(--gc-radius-sm)",
                      }}
                    />
                    <button
                      type="button"
                      data-testid={`tags-manage-rename-save-${tag}`}
                      onClick={() => {
                        if (editing.next.trim()) renameTag(tag, editing.next.trim());
                        setEditing(null);
                      }}
                      style={miniBtn()}
                    >
                      {t("workflows.common.save")}
                    </button>
                  </>
                ) : (
                  <>
                    <span style={{ flex: 1 }}>{tag}</span>
                    <button
                      type="button"
                      data-testid={`tags-manage-edit-${tag}`}
                      onClick={() => setEditing({ name: tag, next: tag })}
                      style={miniBtn()}
                    >
                      {t("workflows.common.rename")}
                    </button>
                    <button
                      type="button"
                      data-testid={`tags-manage-delete-${tag}`}
                      onClick={() => deleteTag(tag)}
                      style={{ ...miniBtn(), color: "#c83a3a" }}
                    >
                      {t("workflows.common.delete")}
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </ModalShell>
  );
}

function miniBtn(): React.CSSProperties {
  return {
    padding: "2px 8px",
    border: "1px solid var(--gc-border)",
    borderRadius: "var(--gc-radius-sm)",
    background: "var(--gc-surface-1)",
    color: "var(--gc-text-primary)",
    cursor: "pointer",
    fontSize: 12,
  };
}
