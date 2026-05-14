// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../ui/Button/Button";

export interface ItemNavigatorProps {
  count: number;
  index: number;
  onChange: (next: number) => void;
}

export function ItemNavigator({ count, index, onChange }: ItemNavigatorProps) {
  const { t } = useTranslation();
  if (count <= 1) return null;
  const clamped = Math.max(0, Math.min(index, count - 1));
  return (
    <div className="gc-ndv-items" data-testid="item-navigator">
      <Button
        variant="ghost"
        size="xsmall"
        iconLeft="chevron-left"
        aria-label={t("app.ndv.items.previous")}
        disabled={clamped <= 0}
        onClick={() => onChange(Math.max(0, clamped - 1))}
      />
      <span className="gc-ndv-items__label" data-testid="item-nav-label">
        {t("app.ndv.items.position", { current: clamped + 1, total: count })}
      </span>
      <Button
        variant="ghost"
        size="xsmall"
        iconLeft="chevron-right"
        aria-label={t("app.ndv.items.next")}
        disabled={clamped >= count - 1}
        onClick={() => onChange(Math.min(count - 1, clamped + 1))}
      />
    </div>
  );
}

export function useItemNavKeys(
  enabled: boolean,
  count: number,
  index: number,
  onChange: (next: number) => void,
): void {
  React.useEffect(() => {
    if (!enabled || count <= 1) return;
    const handler = (e: KeyboardEvent) => {
      // ignore when typing in inputs
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if ((e.target as HTMLElement | null)?.isContentEditable) return;
      if (e.key === "[") {
        e.preventDefault();
        onChange(Math.max(0, index - 1));
      } else if (e.key === "]") {
        e.preventDefault();
        onChange(Math.min(count - 1, index + 1));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, count, index, onChange]);
}
