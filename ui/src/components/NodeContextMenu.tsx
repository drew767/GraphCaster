// Copyright GraphCaster. All Rights Reserved.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useGraphMutationsStore } from "../stores/graphMutationsStore";

type Props = {
  open: boolean;
  screenPos: { x: number; y: number };
  nodeId: string;
  onClose: () => void;
  onDelete: () => void;
};

export function NodeContextMenu({ open, screenPos, nodeId, onClose, onDelete }: Props) {
  const { t } = useTranslation();
  const setNodeMode = useGraphMutationsStore((s) => s.setNodeMode);
  const toggleCollapse = useGraphMutationsStore((s) => s.toggleCollapse);
  const togglePin = useGraphMutationsStore((s) => s.togglePin);

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

  if (!open) {
    return null;
  }

  const ids = [nodeId];

  return (
    <div
      className="gc-ctx-menu gc-node-ctx-menu"
      style={{ left: screenPos.x, top: screenPos.y }}
      role="menu"
      onMouseDown={(ev) => {
        ev.stopPropagation();
      }}
    >
      <div className="gc-ctx-menu__title">{t("app.canvas.nodeContextMenuTitle")}</div>
      <div className="gc-node-ctx-menu__id">{nodeId}</div>
      <button
        type="button"
        className="gc-btn gc-node-ctx-menu__item"
        role="menuitem"
        onClick={() => {
          setNodeMode(ids, "bypass");
          onClose();
        }}
      >
        {t("app.shortcuts.bypass")} <span className="gc-node-ctx-menu__keys">Ctrl+B</span>
      </button>
      <button
        type="button"
        className="gc-btn gc-node-ctx-menu__item"
        role="menuitem"
        onClick={() => {
          setNodeMode(ids, "mute");
          onClose();
        }}
      >
        {t("app.shortcuts.mute")} <span className="gc-node-ctx-menu__keys">Ctrl+M</span>
      </button>
      <button
        type="button"
        className="gc-btn gc-node-ctx-menu__item"
        role="menuitem"
        onClick={() => {
          toggleCollapse(ids);
          onClose();
        }}
      >
        {t("app.shortcuts.collapse")} <span className="gc-node-ctx-menu__keys">Alt+C</span>
      </button>
      <button
        type="button"
        className="gc-btn gc-node-ctx-menu__item"
        role="menuitem"
        onClick={() => {
          togglePin(ids);
          onClose();
        }}
      >
        {t("app.shortcuts.pin")} <span className="gc-node-ctx-menu__keys">P</span>
      </button>
      <button
        type="button"
        className="gc-btn gc-node-ctx-menu__delete"
        role="menuitem"
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        {t("app.canvas.deleteNode")}
      </button>
    </div>
  );
}
