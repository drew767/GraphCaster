// Copyright GraphCaster. All Rights Reserved.

import React from "react";

import "./Card.css";

export interface CardProps {
  variant?: "default" | "outlined" | "elevated";
  padding?: "none" | "small" | "medium" | "large";
  hoverable?: boolean;
  onClick?: () => void;
  className?: string;
  children?: React.ReactNode;
}

interface CardHeaderProps {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

interface CardBodyProps {
  className?: string;
  children?: React.ReactNode;
}

interface CardFooterProps {
  className?: string;
  children?: React.ReactNode;
}

function CardHeader({ title, actions, className, children }: CardHeaderProps) {
  return (
    <div className={["gc-card__header", className].filter(Boolean).join(" ")}>
      {children ?? (
        <>
          {title && <div className="gc-card__header-title">{title}</div>}
          {actions && <div className="gc-card__header-actions">{actions}</div>}
        </>
      )}
    </div>
  );
}
CardHeader.displayName = "Card.Header";

function CardBody({ className, children }: CardBodyProps) {
  return (
    <div className={["gc-card__body", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
CardBody.displayName = "Card.Body";

function CardFooter({ className, children }: CardFooterProps) {
  return (
    <div className={["gc-card__footer", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
CardFooter.displayName = "Card.Footer";

const CardRoot = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      variant = "default",
      padding = "medium",
      hoverable = false,
      onClick,
      className,
      children,
    },
    ref,
  ) => {
    const classes = [
      "gc-card",
      `gc-card--${variant}`,
      `gc-card--padding-${padding}`,
      hoverable ? "gc-card--hoverable" : "",
      onClick ? "gc-card--clickable" : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        ref={ref}
        className={classes}
        onClick={onClick}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={
          onClick
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onClick();
                }
              }
            : undefined
        }
      >
        {children}
      </div>
    );
  },
);
CardRoot.displayName = "Card";

export const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Body: CardBody,
  Footer: CardFooter,
});
