// Copyright GraphCaster. All Rights Reserved.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkflowFilters, WorkflowStatus } from "./types";
import { useWorkflowsStore } from "./workflowsStore";

interface FiltersBarProps {
  filters: WorkflowFilters;
  onChange: (next: WorkflowFilters) => void;
}

const STATUS_OPTIONS: Array<"all" | WorkflowStatus> = ["all", "active", "inactive", "archived"];

export function FiltersBar({ filters, onChange }: FiltersBarProps): JSX.Element {
  const { t } = useTranslation();
  const tags = useWorkflowsStore((s) => s.tags);
  const projects = useWorkflowsStore((s) => s.projects);
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);

  const anyActive =
    !!filters.search ||
    filters.status !== "all" ||
    filters.tags.length > 0 ||
    filters.project !== null;

  function toggleTag(name: string) {
    const has = filters.tags.includes(name);
    const nextTags = has ? filters.tags.filter((x) => x !== name) : [...filters.tags, name];
    onChange({ ...filters, tags: nextTags });
  }

  return (
    <div
      data-testid="filters-bar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderBottom: "1px solid var(--gc-border)",
        flexWrap: "wrap",
      }}
    >
      <input
        type="search"
        data-testid="filter-search"
        aria-label={t("workflows.filters.searchPlaceholder")}
        placeholder={t("workflows.filters.searchPlaceholder")}
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
        style={{
          flex: "0 0 220px",
          padding: "4px 8px",
          border: "1px solid var(--gc-border)",
          borderRadius: "var(--gc-radius-sm)",
          fontSize: 13,
        }}
      />

      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 12,
          color: "var(--gc-text-secondary)",
        }}
      >
        {t("workflows.filters.status")}
        <select
          data-testid="filter-status"
          value={filters.status}
          onChange={(e) =>
            onChange({ ...filters, status: e.target.value as WorkflowFilters["status"] })
          }
          style={{
            padding: "3px 6px",
            border: "1px solid var(--gc-border)",
            borderRadius: "var(--gc-radius-sm)",
            fontSize: 13,
            background: "var(--gc-surface-1)",
            color: "var(--gc-text-primary)",
          }}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {t(`workflows.filters.statusOption.${s}`)}
            </option>
          ))}
        </select>
      </label>

      <div style={{ position: "relative" }}>
        <button
          type="button"
          data-testid="filter-tags-toggle"
          onClick={() => setTagPopoverOpen((x) => !x)}
          aria-expanded={tagPopoverOpen}
          style={{
            padding: "4px 8px",
            border: "1px solid var(--gc-border)",
            borderRadius: "var(--gc-radius-sm)",
            background: "var(--gc-surface-1)",
            color: "var(--gc-text-primary)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          {t("workflows.filters.tags")}
          {filters.tags.length > 0 ? ` (${filters.tags.length})` : ""}
        </button>
        {tagPopoverOpen ? (
          <div
            role="dialog"
            data-testid="filter-tags-popover"
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              marginTop: 4,
              padding: 8,
              minWidth: 180,
              background: "var(--gc-surface-1)",
              border: "1px solid var(--gc-border)",
              borderRadius: "var(--gc-radius-md)",
              boxShadow: "var(--gc-shadow-raise)",
              zIndex: 5,
            }}
          >
            {tags.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--gc-text-secondary)" }}>
                {t("workflows.filters.noTags")}
              </div>
            ) : (
              tags.map((tag) => (
                <label
                  key={tag}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13,
                    padding: "2px 0",
                  }}
                >
                  <input
                    type="checkbox"
                    data-testid={`filter-tag-${tag}`}
                    checked={filters.tags.includes(tag)}
                    onChange={() => toggleTag(tag)}
                  />
                  {tag}
                </label>
              ))
            )}
          </div>
        ) : null}
      </div>

      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 12,
          color: "var(--gc-text-secondary)",
        }}
      >
        {t("workflows.filters.project")}
        <select
          data-testid="filter-project"
          value={filters.project ?? ""}
          onChange={(e) =>
            onChange({ ...filters, project: e.target.value === "" ? null : e.target.value })
          }
          style={{
            padding: "3px 6px",
            border: "1px solid var(--gc-border)",
            borderRadius: "var(--gc-radius-sm)",
            fontSize: 13,
            background: "var(--gc-surface-1)",
            color: "var(--gc-text-primary)",
          }}
        >
          <option value="">{t("workflows.filters.projectAll")}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      {anyActive ? (
        <button
          type="button"
          data-testid="filters-clear"
          onClick={() =>
            onChange({ search: "", status: "all", tags: [], project: null, folderId: filters.folderId })
          }
          style={{
            background: "transparent",
            border: "none",
            color: "var(--gc-accent)",
            cursor: "pointer",
            fontSize: 13,
            padding: 0,
          }}
        >
          {t("workflows.filters.clear")}
        </button>
      ) : null}
    </div>
  );
}
