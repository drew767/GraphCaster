// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { useTranslation } from "react-i18next";

import { Button, type ButtonVariant } from "../Button/Button";
import { Icon, type IconName } from "../Icon/Icon";
import "./EmptyState.css";

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
  variant?: ButtonVariant;
}

export interface EmptyStateSecondaryAction {
  label: string;
  onClick?: () => void;
  href?: string;
}

export interface EmptyStateProps {
  icon?: IconName;
  illustration?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateSecondaryAction;
  size?: "small" | "medium" | "large";
  className?: string;
}

export function EmptyState({
  icon,
  illustration,
  title,
  description,
  action,
  secondaryAction,
  size = "medium",
  className,
}: EmptyStateProps) {
  const { t } = useTranslation();

  const rootClass = [
    "gc-empty-state",
    `gc-empty-state--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  function handleSecondaryClick(e: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>) {
    if (secondaryAction?.onClick) {
      e.preventDefault();
      secondaryAction.onClick();
    }
  }

  return (
    <div className={rootClass} data-testid="empty-state" role="status" aria-live="polite">
      {illustration ? (
        <div className="gc-empty-state__illustration">{illustration}</div>
      ) : icon ? (
        <div className="gc-empty-state__icon" aria-hidden="true">
          <Icon
            name={icon}
            size={size === "small" ? 32 : size === "large" ? 64 : 48}
          />
        </div>
      ) : null}

      <div className="gc-empty-state__body">
        <p className="gc-empty-state__title">{title}</p>
        {description && (
          <p className="gc-empty-state__description">{description}</p>
        )}
      </div>

      {(action || secondaryAction) && (
        <div className="gc-empty-state__actions">
          {action && (
            <Button
              variant={action.variant ?? "solid"}
              size={size === "small" ? "small" : "medium"}
              onClick={action.onClick}
              {...(action.href ? { asChild: false } : {})}
            >
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <a
              className="gc-empty-state__secondary-link"
              href={secondaryAction.href ?? "#"}
              onClick={handleSecondaryClick}
              aria-label={secondaryAction.label}
            >
              {secondaryAction.label}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
