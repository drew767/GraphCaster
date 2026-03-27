// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ADD_MENU_PRIMITIVE_ORDER,
  type AddMenuPrimitiveType,
  type AddNodeMenuPick,
  type WorkspaceGraphAddMenuRow,
} from "../graph/addNodeMenu";
import { GRAPH_NODE_TYPE_GRAPH_REF } from "../graph/nodeKinds";

type Props = {
  open: boolean;
  screenPos: { x: number; y: number };
  flowPos: { x: number; y: number };
  hasStartNode: boolean;
  workspaceGraphs: ReadonlyArray<WorkspaceGraphAddMenuRow>;
  onClose: () => void;
  onPick: (pick: AddNodeMenuPick, flowPosition: { x: number; y: number }) => void;
};

export function CanvasAddNodeMenu({
  open,
  screenPos,
  flowPos,
  hasStartNode,
  workspaceGraphs,
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

  const { primitiveOptions, graphOptions } = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const primitives = ADD_MENU_PRIMITIVE_ORDER.filter((ty) => {
      if (ty === "start" && hasStartNode) {
        return false;
      }
      if (q === "") {
        return true;
      }
      const label = t(`app.canvas.nodeTypes.${ty}`).toLowerCase();
      return ty.includes(q) || label.includes(q);
    });
    const graphs = workspaceGraphs.filter((row) => {
      if (q === "") {
        return true;
      }
      return (
        row.graphId.toLowerCase().includes(q) ||
        row.label.toLowerCase().includes(q) ||
        row.fileName.toLowerCase().includes(q)
      );
    });
    return { primitiveOptions: primitives, graphOptions: graphs };
  }, [filter, hasStartNode, t, workspaceGraphs]);

  if (!open) {
    return null;
  }

  const totalCount = primitiveOptions.length + graphOptions.length;

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
        {totalCount === 0 ? (
          <li className="gc-ctx-menu__empty">{t("app.canvas.addNodeNoMatch")}</li>
        ) : (
          <>
            {primitiveOptions.map((ty: AddMenuPrimitiveType) => (
              <li key={ty}>
                <button
                  type="button"
                  className="gc-ctx-menu__btn"
                  role="menuitem"
                  onClick={() => {
                    onPick({ kind: "primitive", nodeType: ty }, flowPos);
                    onClose();
                  }}
                >
                  <span className="gc-ctx-menu__ty">{ty}</span>
                  <span className="gc-ctx-menu__lbl">{t(`app.canvas.nodeTypes.${ty}`)}</span>
                </button>
              </li>
            ))}
            {graphOptions.length > 0 ? (
              <>
                {primitiveOptions.length > 0 ? (
                  <li className="gc-ctx-menu__section" aria-hidden="true">
                    {t("app.canvas.addNodeGraphsHeading")}
                  </li>
                ) : null}
                {graphOptions.map((row) => (
                  <li key={row.fileName}>
                    <button
                      type="button"
                      className="gc-ctx-menu__btn"
                      role="menuitem"
                      onClick={() => {
                        onPick({ kind: "graph_ref", targetGraphId: row.graphId }, flowPos);
                        onClose();
                      }}
                    >
                      <span className="gc-ctx-menu__ty">{GRAPH_NODE_TYPE_GRAPH_REF}</span>
                      <span className="gc-ctx-menu__lbl">{row.label}</span>
                    </button>
                  </li>
                ))}
              </>
            ) : null}
          </>
        )}
      </ul>
    </div>
  );
}
