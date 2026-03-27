// Copyright Aura. All Rights Reserved.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { NODE_TYPE_ORDER, type PaletteNodeType } from "../graph/nodePalette";

type Props = {
  open: boolean;
  screenPos: { x: number; y: number };
  flowPos: { x: number; y: number };
  hasStartNode: boolean;
  onClose: () => void;
  onPick: (nodeType: PaletteNodeType, flowPosition: { x: number; y: number }) => void;
};

export function CanvasAddNodeMenu({
  open,
  screenPos,
  flowPos,
  hasStartNode,
  onClose,
  onPick,
}: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!open) {
      setFilter("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const options = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return NODE_TYPE_ORDER.filter((ty) => {
      if (ty === "start" && hasStartNode) {
        return false;
      }
      if (q === "") {
        return true;
      }
      const label = t(`app.canvas.nodeTypes.${ty}`).toLowerCase();
      return ty.includes(q) || label.includes(q);
    });
  }, [filter, hasStartNode, t]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="gc-ctx-menu"
      style={{ left: screenPos.x, top: screenPos.y }}
      role="menu"
      onMouseDown={(ev) => {
        ev.stopPropagation();
      }}
    >
      <div className="gc-ctx-menu__title">{t("app.canvas.addNodeTitle")}</div>
      <input
        type="search"
        className="gc-ctx-menu__filter"
        value={filter}
        placeholder={t("app.canvas.addNodeFilterPh")}
        aria-label={t("app.canvas.addNodeFilterPh")}
        onChange={(e) => {
          setFilter(e.target.value);
        }}
        autoFocus
      />
      <ul className="gc-ctx-menu__list">
        {options.length === 0 ? (
          <li className="gc-ctx-menu__empty">{t("app.canvas.addNodeNoMatch")}</li>
        ) : (
          options.map((ty) => (
            <li key={ty}>
              <button
                type="button"
                className="gc-ctx-menu__btn"
                role="menuitem"
                onClick={() => {
                  onPick(ty, flowPos);
                  onClose();
                }}
              >
                <span className="gc-ctx-menu__ty">{ty}</span>
                <span className="gc-ctx-menu__lbl">{t(`app.canvas.nodeTypes.${ty}`)}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
