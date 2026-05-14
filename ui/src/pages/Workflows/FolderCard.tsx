// Copyright GraphCaster. All Rights Reserved.

import React, { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "../../components/ui/Icon/Icon";
import { DropdownMenu } from "../../components/ui/DropdownMenu/DropdownMenu";
import { Button } from "../../components/ui/Button/Button";
import { InlineTextEdit } from "../../components/ui/InlineTextEdit/InlineTextEdit";

export interface FolderCardProps {
  path: string;
  name: string;
  workflowCount: number;
  subFolderCount?: number;
  onClick: () => void;
  onRename?: (newName: string) => void;
  onDelete?: () => void;
}

export function FolderCard({
  name,
  workflowCount,
  subFolderCount = 0,
  onClick,
  onRename,
  onDelete,
}: FolderCardProps) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);

  const handleRenameCommit = useCallback(
    (newName: string) => {
      setRenaming(false);
      if (newName.trim() && newName.trim() !== name) {
        onRename?.(newName.trim());
      }
    },
    [name, onRename],
  );

  const menuItems = [
    ...(onRename
      ? [
          {
            id: "rename",
            label: t("app.workflows.folder.rename"),
            icon: "pencil" as const,
            onSelect: () => setRenaming(true),
          },
        ]
      : []),
    ...(onDelete
      ? [
          {
            id: "delete",
            label: t("app.workflows.folder.delete"),
            icon: "trash-2" as const,
            destructive: true,
            onSelect: onDelete,
          },
        ]
      : []),
  ];

  return (
    <div
      className="gc-folder-card"
      data-testid="folder-card"
      role="button"
      tabIndex={0}
      onClick={renaming ? undefined : onClick}
      onKeyDown={(e) => {
        if (!renaming && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={t("app.workflows.folder.ariaLabel", { name })}
    >
      <div className="gc-folder-card__icon" aria-hidden>
        <Icon name="folder" size={32} />
      </div>

      <div className="gc-folder-card__body">
        {renaming ? (
          <InlineTextEdit
            value={name}
            onChange={handleRenameCommit}
            onCancel={() => setRenaming(false)}
            commitOn="both"
          />
        ) : (
          <span className="gc-folder-card__name">{name}</span>
        )}
        <span className="gc-folder-card__meta">
          {t("app.workflows.folder.workflowCount", { count: workflowCount })}
          {subFolderCount > 0 &&
            ` · ${t("app.workflows.folder.subFolderCount", { count: subFolderCount })}`}
        </span>
      </div>

      {menuItems.length > 0 && (
        <div
          className="gc-folder-card__actions"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <DropdownMenu
            trigger={
              <Button
                variant="ghost"
                size="xsmall"
                iconLeft="ellipsis"
                aria-label={t("app.workflows.folder.moreActions")}
              />
            }
            items={menuItems}
            align="end"
          />
        </div>
      )}
    </div>
  );
}
