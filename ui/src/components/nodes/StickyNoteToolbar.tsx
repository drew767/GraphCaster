// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";

export const STICKY_COLORS = ["yellow", "blue", "pink", "green", "purple", "gray"] as const;
export type StickyColor = (typeof STICKY_COLORS)[number];

export interface StickyNoteToolbarProps {
  selected: StickyColor;
  onSelect: (color: StickyColor) => void;
}

export function StickyNoteToolbar({ selected, onSelect }: StickyNoteToolbarProps) {
  const { t } = useTranslation();
  return (
    <div
      className="gc-sticky-note-toolbar"
      data-testid="sticky-note-toolbar"
      role="toolbar"
      aria-label={t("canvas.sticky.toolbarLabel")}
      style={{
        position: "absolute",
        top: -36,
        left: 0,
        display: "flex",
        gap: 4,
        padding: 4,
        background: "var(--gc-surface-1)",
        border: "1px solid var(--gc-border)",
        borderRadius: 6,
        boxShadow: "var(--gc-shadow-raise)",
        zIndex: 10,
      }}
    >
      {STICKY_COLORS.map((color) => {
        const label = t(`canvas.sticky.colors.${color}`);
        return (
          <button
            key={color}
            type="button"
            className={`gc-sticky-note-toolbar__swatch${selected === color ? " gc-sticky-note-toolbar__swatch--selected" : ""}`}
            data-testid={`sticky-color-${color}`}
            data-color={color}
            aria-label={label}
            aria-pressed={selected === color}
            title={label}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(color);
            }}
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              backgroundColor: `var(--gc-sticky-bg-${color})`,
              border:
                selected === color
                  ? "2px solid var(--gc-accent)"
                  : "1px solid var(--gc-border)",
              cursor: "pointer",
              padding: 0,
            }}
          />
        );
      })}
    </div>
  );
}
