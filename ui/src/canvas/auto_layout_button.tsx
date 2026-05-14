// Copyright GraphCaster. All Rights Reserved.

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { LayoutAlgorithm } from "./auto_layout";

export type AutoLayoutAlgorithmOption = {
  algorithm: LayoutAlgorithm;
  labelKey: string;
};

const ALGORITHM_OPTIONS: AutoLayoutAlgorithmOption[] = [
  { algorithm: "dagre-lr", labelKey: "app.canvas.autoLayoutLr" },
  { algorithm: "dagre-tb", labelKey: "app.canvas.autoLayoutTb" },
  { algorithm: "elk-layered", labelKey: "app.canvas.autoLayoutElkLayered" },
  { algorithm: "elk-force", labelKey: "app.canvas.autoLayoutElkForce" },
];

type Props = {
  onLayout: (algorithm: LayoutAlgorithm) => void;
  disabled?: boolean;
};

export function AutoLayoutButton({ onLayout, disabled = false }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [activeAlgorithm, setActiveAlgorithm] = useState<LayoutAlgorithm>("dagre-lr");
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleMainClick = () => {
    if (disabled) {
      return;
    }
    onLayout(activeAlgorithm);
  };

  const handleArrowClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) {
      return;
    }
    setOpen((prev) => !prev);
  };

  const handleOptionClick = (algorithm: LayoutAlgorithm) => {
    setActiveAlgorithm(algorithm);
    setOpen(false);
    onLayout(algorithm);
  };

  const activeOption = ALGORITHM_OPTIONS.find((o) => o.algorithm === activeAlgorithm);

  return (
    <div className="gc-auto-layout-btn-wrap">
      <button
        ref={buttonRef}
        type="button"
        className="gc-btn gc-auto-layout-btn"
        onClick={handleMainClick}
        disabled={disabled}
        title={t("app.canvas.autoLayoutHint")}
        aria-label={t("app.canvas.autoLayout")}
      >
        {t("app.canvas.autoLayout")}
        {activeOption ? ` (${t(activeOption.labelKey)})` : ""}
      </button>
      <button
        type="button"
        className="gc-btn gc-auto-layout-arrow"
        onClick={handleArrowClick}
        disabled={disabled}
        aria-label={t("app.canvas.autoLayoutDropdownAria")}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        ▾
      </button>
      {open ? (
        <ul
          className="gc-auto-layout-dropdown"
          role="listbox"
          aria-label={t("app.canvas.autoLayoutDropdownAria")}
        >
          {ALGORITHM_OPTIONS.map((opt) => (
            <li
              key={opt.algorithm}
              role="option"
              aria-selected={opt.algorithm === activeAlgorithm}
              className={`gc-auto-layout-option${opt.algorithm === activeAlgorithm ? " gc-auto-layout-option--active" : ""}`}
              onClick={() => handleOptionClick(opt.algorithm)}
            >
              {t(opt.labelKey)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
