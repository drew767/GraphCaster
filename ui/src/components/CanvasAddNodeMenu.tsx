// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ADD_NODE_CATEGORY_ORDER,
  type AddMenuPrimitiveType,
  type AddNodeCategoryId,
  type AddNodeMenuPick,
  computeAddNodeMenuLists,
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
  const [category, setCategory] = useState<AddNodeCategoryId>("all");

  useEffect(() => {
    if (!open) {
      setFilter("");
      setCategory("all");
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
    return computeAddNodeMenuLists({
      category,
      filterText: filter,
      hasStartNode,
      workspaceGraphs,
      labelForPrimitive: (ty) => {
        return t(`app.canvas.nodeTypes.${ty}`);
      },
    });
  }, [category, filter, hasStartNode, t, workspaceGraphs]);

  if (!open) {
    return null;
  }

  const totalCount = primitiveOptions.length + graphOptions.length;
  const nestedEmptyWorkspace =
    category === "nested" && workspaceGraphs.length === 0 && filter.trim() === "";

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
      <div className="gc-ctx-menu__chips" role="group" aria-label={t("app.canvas.addNodeCategoryGroup")}>
        {ADD_NODE_CATEGORY_ORDER.map((id) => {
          return (
            <button
              key={id}
              type="button"
              className={`gc-ctx-menu__chip${category === id ? " gc-ctx-menu__chip--active" : ""}`}
              aria-pressed={category === id}
              onClick={() => {
                setCategory(id);
              }}
            >
              {t(`app.canvas.addNodeCategory.${id}`)}
            </button>
          );
        })}
      </div>
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
        {nestedEmptyWorkspace ? (
          <li className="gc-ctx-menu__empty">{t("app.canvas.addNodeNestedEmptyWorkspace")}</li>
        ) : totalCount === 0 ? (
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
