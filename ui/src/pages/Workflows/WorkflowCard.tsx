// Copyright GraphCaster. All Rights Reserved.

import React, { forwardRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { Tag } from "../../components/ui/Tag/Tag";
import { Pill } from "../../components/ui/Pill/Pill";
import { Button } from "../../components/ui/Button/Button";
import { DropdownMenu } from "../../components/ui/DropdownMenu/DropdownMenu";
import { WorkflowTagsContainer } from "../../components/workflows/WorkflowTagsContainer";

export interface WorkflowCardData {
  id: string;
  name: string;
  tags: string[];
  active: boolean;
  archived: boolean;
  updatedAt: string;
  folder?: string;
}

export interface WorkflowCardProps {
  workflow: WorkflowCardData;
  availableTags?: string[];
  onTagsChange?: (id: string, tags: string[]) => void;
  onArchive?: (id: string) => void;
  onRestore?: (id: string) => void;
  onOpen?: (id: string) => void;
  onDelete?: (id: string) => void;
  /** Keyboard navigation: when defined, the card is treated as a focusable list row. */
  tabIndex?: number;
  ariaSelected?: boolean;
  focused?: boolean;
  onFocus?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export const WorkflowCard = forwardRef<HTMLDivElement, WorkflowCardProps>(function WorkflowCard({
  workflow,
  availableTags = [],
  onTagsChange,
  onArchive,
  onRestore,
  onOpen,
  onDelete,
  tabIndex,
  ariaSelected,
  focused,
  onFocus,
  onKeyDown,
}, ref) {
  const { t } = useTranslation();

  const menuItems = [
    {
      id: "open",
      label: t("app.workflows.archive.open"),
      icon: "folder-open" as const,
      onSelect: () => onOpen?.(workflow.id),
    },
    ...(workflow.archived
      ? [
          {
            id: "restore",
            label: t("app.workflows.archive.restore"),
            icon: "archive-restore" as const,
            onSelect: () => onRestore?.(workflow.id),
          },
        ]
      : [
          {
            id: "archive",
            label: t("app.workflows.archive.archive"),
            icon: "archive" as const,
            onSelect: () => onArchive?.(workflow.id),
          },
        ]),
    ...(onDelete
      ? [
          { id: "sep-del", separator: true } as const,
          {
            id: "delete",
            label: t("app.workflows.archive.delete"),
            icon: "trash-2" as const,
            destructive: true,
            onSelect: () => onDelete?.(workflow.id),
          },
        ]
      : []),
  ];

  return (
    <div
      ref={ref}
      className={[
        "gc-workflow-card",
        workflow.archived ? "gc-workflow-card--archived" : "",
        focused ? "gc-list-row--focused" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid="workflow-card"
      data-workflow-id={workflow.id}
      tabIndex={tabIndex}
      aria-selected={ariaSelected}
      role={tabIndex !== undefined ? "option" : undefined}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
    >
      <div className="gc-workflow-card__header">
        <span className="gc-workflow-card__name">{workflow.name}</span>
        <div className="gc-workflow-card__header-actions">
          {workflow.archived && (
            <Pill variant="warning" size="small">
              {t("app.workflows.archive.archivedPill")}
            </Pill>
          )}
          <DropdownMenu
            trigger={
              <Button
                variant="ghost"
                size="xsmall"
                iconLeft="ellipsis"
                aria-label={t("app.workflows.archive.moreActions")}
              />
            }
            items={menuItems}
            align="end"
          />
        </div>
      </div>

      <div className="gc-workflow-card__body">
        <Tag
          size="small"
          variant={workflow.active ? "success" : "default"}
        >
          {workflow.active
            ? t("app.workflows.archive.active")
            : t("app.workflows.archive.inactive")}
        </Tag>
        <span className="gc-workflow-card__updated">{workflow.updatedAt}</span>
      </div>

      {onTagsChange ? (
        <div className="gc-workflow-card__tags">
          <WorkflowTagsContainer
            tags={workflow.tags}
            onChange={(newTags) => onTagsChange(workflow.id, newTags)}
            availableTags={availableTags}
          />
        </div>
      ) : (
        <div className="gc-workflow-card__tags">
          {workflow.tags.map((tag) => (
            <Tag key={tag} size="small">
              {tag}
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
});
