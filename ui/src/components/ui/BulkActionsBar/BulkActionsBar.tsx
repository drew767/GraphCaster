// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { useTranslation } from "react-i18next";

import { Button, type ButtonVariant } from "../Button/Button";
import { type IconName } from "../Icon/Icon";
import "./BulkActionsBar.css";

export interface BulkAction {
  id: string;
  label: string;
  icon?: IconName;
  variant?: ButtonVariant;
  onClick: () => void;
  destructive?: boolean;
  requiresConfirmation?: boolean;
}

export interface BulkActionsBarProps {
  selectedCount: number;
  totalCount?: number;
  actions: BulkAction[];
  onClearSelection: () => void;
  position?: "top" | "bottom";
  className?: string;
}

export function BulkActionsBar({
  selectedCount,
  totalCount,
  actions,
  onClearSelection,
  position = "top",
  className,
}: BulkActionsBarProps) {
  const { t } = useTranslation();

  const visible = selectedCount > 0;

  const rootClass = [
    "gc-bulk-bar",
    `gc-bulk-bar--${position}`,
    visible ? "gc-bulk-bar--visible" : "gc-bulk-bar--hidden",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const countLabel =
    totalCount != null
      ? t("app.bulk.selectedOfTotal", "{{count}} of {{total}} selected", {
          count: selectedCount,
          total: totalCount,
        })
      : t("app.bulk.selected", "{{count}} selected", { count: selectedCount });

  return (
    <div
      className={rootClass}
      data-testid="bulk-actions-bar"
      aria-live="polite"
      aria-atomic="true"
      aria-hidden={!visible}
    >
      <div className="gc-bulk-bar__info">
        <span className="gc-bulk-bar__count">{countLabel}</span>
        <button
          type="button"
          className="gc-bulk-bar__clear-btn"
          onClick={onClearSelection}
          aria-label={t("app.bulk.clearSelection", "Clear selection")}
        >
          {t("app.bulk.clearSelection", "Clear selection")}
        </button>
      </div>

      <div className="gc-bulk-bar__actions">
        {actions.map((action) => (
          <Button
            key={action.id}
            variant={
              action.destructive
                ? "destructive"
                : action.variant ?? "outline"
            }
            size="small"
            iconLeft={action.icon}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
