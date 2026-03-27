// Copyright GraphCaster. All Rights Reserved.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  open: boolean;
  screenPos: { x: number; y: number };
  nodeId: string;
  onClose: () => void;
  onDelete: () => void;
};

export function NodeContextMenu({ open, screenPos, nodeId, onClose, onDelete }: Props) {
  const { t } = useTranslation();

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
