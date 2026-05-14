// Copyright GraphCaster. All Rights Reserved.

import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";

import { useTheme, type Theme } from "./ThemeProvider";

function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

interface OptionDef {
  value: Theme;
  labelKey: string;
  icon: () => ReactElement;
}

const OPTIONS: ReadonlyArray<OptionDef> = [
  { value: "light", labelKey: "theme.light", icon: SunIcon },
  { value: "system", labelKey: "theme.system", icon: MonitorIcon },
  { value: "dark", labelKey: "theme.dark", icon: MoonIcon },
];

export function ThemeSwitcher() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <div
      className="gc-theme-switcher"
      role="radiogroup"
      aria-label={t("theme.selectLabel")}
    >
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const label = t(opt.labelKey);
        const selected = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            className={selected ? "gc-theme-switcher-btn is-selected" : "gc-theme-switcher-btn"}
            onClick={() => {
              setTheme(opt.value);
            }}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}
