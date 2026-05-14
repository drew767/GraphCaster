// Copyright GraphCaster. All Rights Reserved.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWorkflowsStore } from "./workflowsStore";

interface TagEditorPopoverProps {
  workflowId: string;
  currentTags: string[];
  onClose: () => void;
  onManageOpen: () => void;
}

export function TagEditorPopover(props: TagEditorPopoverProps): JSX.Element {
  const { workflowId, currentTags, onClose, onManageOpen } = props;
  const { t } = useTranslation();
  const allTags = useWorkflowsStore((s) => s.tags);
  const setWorkflowTags = useWorkflowsStore((s) => s.setWorkflowTags);
  const addTag = useWorkflowsStore((s) => s.addTag);
  const [query, setQuery] = useState("");

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allTags.slice(0, 20);
    return allTags.filter((tg) => tg.toLowerCase().includes(q)).slice(0, 20);
  }, [allTags, query]);

  function toggle(name: string) {
    const has = currentTags.includes(name);
    const next = has ? currentTags.filter((t2) => t2 !== name) : [...currentTags, name];
    setWorkflowTags(workflowId, next);
  }

  function commitNew() {
    const v = query.trim();
    if (!v) return;
    addTag(v);
    if (!currentTags.includes(v)) {
      setWorkflowTags(workflowId, [...currentTags, v]);
    }
    setQuery("");
  }

  return (
    <div
      role="dialog"
      data-testid="tag-editor-popover"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        marginTop: 4,
        padding: 8,
        minWidth: 200,
        background: "var(--gc-surface-1)",
        border: "1px solid var(--gc-border)",
        borderRadius: "var(--gc-radius-md)",
        boxShadow: "var(--gc-shadow-raise)",
        zIndex: 8,
      }}
    >
      <input
        autoFocus
        data-testid="tag-editor-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitNew();
          if (e.key === "Escape") onClose();
        }}
        placeholder={t("workflows.tagEditor.placeholder")}
        aria-label={t("workflows.tagEditor.placeholder")}
        style={{
          width: "100%",
          padding: "4px 6px",
          border: "1px solid var(--gc-border)",
          borderRadius: "var(--gc-radius-sm)",
          fontSize: 13,
          marginBottom: 6,
        }}
      />
      <div style={{ maxHeight: 160, overflow: "auto" }}>
        {suggestions.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--gc-text-secondary)", padding: "4px 0" }}>
            {t("workflows.tagEditor.empty")}
          </div>
        ) : (
          suggestions.map((tag) => (
            <label
              key={tag}
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "2px 0" }}
            >
              <input
                type="checkbox"
                data-testid={`tag-editor-toggle-${tag}`}
                checked={currentTags.includes(tag)}
                onChange={() => toggle(tag)}
              />
              {tag}
            </label>
          ))
        )}
      </div>
      <div
        style={{
          marginTop: 6,
          paddingTop: 6,
          borderTop: "1px solid var(--gc-border)",
          display: "flex",
          gap: 6,
        }}
      >
        <button
          type="button"
          data-testid="tag-editor-manage"
          onClick={onManageOpen}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--gc-accent)",
            cursor: "pointer",
            fontSize: 12,
            padding: 0,
          }}
        >
          {t("workflows.tagEditor.manage")}
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          data-testid="tag-editor-close"
          onClick={onClose}
          style={{
            background: "transparent",
            border: "1px solid var(--gc-border)",
            borderRadius: "var(--gc-radius-sm)",
            padding: "2px 8px",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          {t("workflows.common.done")}
        </button>
      </div>
    </div>
  );
}
