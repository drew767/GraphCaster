// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";
import type { WorkflowView } from "./types";

interface ToggleTabsProps {
  value: WorkflowView;
  onChange: (next: WorkflowView) => void;
}

export function ToggleTabs({ value, onChange }: ToggleTabsProps): JSX.Element {
  const { t } = useTranslation();
  const tabs: WorkflowView[] = ["all", "archived"];
  return (
    <div
      role="tablist"
      data-testid="view-tabs"
      style={{
        display: "inline-flex",
        gap: 4,
        background: "var(--gc-surface-2)",
        padding: 2,
        borderRadius: "var(--gc-radius-md)",
      }}
    >
      {tabs.map((tab) => {
        const selected = tab === value;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`view-tab-${tab}`}
            onClick={() => onChange(tab)}
            style={{
              padding: "4px 12px",
              border: "none",
              borderRadius: "var(--gc-radius-sm)",
              background: selected ? "var(--gc-surface-1)" : "transparent",
              color: "var(--gc-text-primary)",
              fontSize: 13,
              cursor: "pointer",
              fontWeight: selected ? 600 : 400,
            }}
          >
            {t(`workflows.view.${tab}`)}
          </button>
        );
      })}
    </div>
  );
}
