// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";
import type { SortKey } from "./types";

const KEYS: SortKey[] = [
  "updated-desc",
  "updated-asc",
  "created-desc",
  "created-asc",
  "name-asc",
  "name-desc",
  "active-first",
];

interface SortDropdownProps {
  value: SortKey;
  onChange: (next: SortKey) => void;
}

export function SortDropdown({ value, onChange }: SortDropdownProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        color: "var(--gc-text-secondary)",
      }}
    >
      {t("workflows.sort.label")}
      <select
        data-testid="sort-dropdown"
        value={value}
        onChange={(e) => onChange(e.target.value as SortKey)}
        style={{
          padding: "3px 6px",
          border: "1px solid var(--gc-border)",
          borderRadius: "var(--gc-radius-sm)",
          fontSize: 13,
          background: "var(--gc-surface-1)",
          color: "var(--gc-text-primary)",
        }}
      >
        {KEYS.map((k) => (
          <option key={k} value={k}>
            {t(`workflows.sort.option.${k}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function sortLocalStorageKey(): string {
  return "gc.workflows.sort";
}

export function readPersistedSort(fallback: SortKey = "updated-desc"): SortKey {
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(sortLocalStorageKey());
  if (!raw) return fallback;
  if (KEYS.includes(raw as SortKey)) return raw as SortKey;
  return fallback;
}

export function writePersistedSort(value: SortKey): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(sortLocalStorageKey(), value);
  } catch {
    // ignore
  }
}
