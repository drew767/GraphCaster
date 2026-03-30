// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ADD_NODE_CATEGORY_ORDER,
  type AddMenuPrimitiveType,
  type AddNodeCategoryId,
  type AddNodeConnectMenuFilter,
  type AddNodeMenuPick,
  computeAddNodeMenuLists,
  type WorkspaceGraphAddMenuRow,
} from "../graph/addNodeMenu";
import type { NodeTemplateId } from "../graph/nodeTemplates";
import { GRAPH_NODE_TYPE_GRAPH_REF } from "../graph/nodeKinds";
import { isTextEditingTarget } from "../lib/isTextEditingTarget";

type Props = {
  open: boolean;
  screenPos: { x: number; y: number };
  flowPos: { x: number; y: number };
  hasStartNode: boolean;
  workspaceGraphs: ReadonlyArray<WorkspaceGraphAddMenuRow>;
  /** When opening from a connection drop, only compatible target types are listed. */
  connectFilter?: AddNodeConnectMenuFilter | null;
  onClose: () => void;
  onPick: (pick: AddNodeMenuPick, flowPosition: { x: number; y: number }) => void;
};

export function CanvasAddNodeMenu({
  open,
  screenPos,
  flowPos,
  hasStartNode,
  workspaceGraphs,
  connectFilter = null,
  onClose,
  onPick,
}: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState<AddNodeCategoryId>("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) {
      setFilter("");
      setCategory("all");
      setActiveIndex(0);
    }
  }, [open]);

  const labelForTemplate = useCallback(
    (id: NodeTemplateId) => {
      return t(`app.canvas.nodeTemplates.${id}`);
    },
    [t],
  );

  const { primitiveOptions, graphOptions, templateOptions } = useMemo(() => {
    return computeAddNodeMenuLists({
      category,
      filterText: filter,
      hasStartNode,
      workspaceGraphs,
      labelForPrimitive: (ty) => {
        return t(`app.canvas.nodeTypes.${ty}`);
      },
      labelForTemplate,
      connectFilter,
    });
  }, [category, connectFilter, filter, hasStartNode, labelForTemplate, t, workspaceGraphs]);

  const showCursorAgentRow = useMemo(() => {
    if (connectFilter && !connectFilter.allowCursorAgent) {
      return false;
    }
    if (category === "templates") {
      return false;
    }
    if (category !== "all" && category !== "steps") {
      return false;
    }
    const q = filter.trim().toLowerCase();
    if (q === "") {
      return true;
    }
    const lbl = t("app.canvas.addNodeCursorAgent").toLowerCase();
    return (
      lbl.includes(q) ||
      "cursor".includes(q) ||
      "agent".includes(q) ||
      lbl.split(/\s+/).some((w) => w.startsWith(q))
    );
  }, [category, connectFilter, filter, t]);

  const itemCount =
    primitiveOptions.length +
    (showCursorAgentRow ? 1 : 0) +
    templateOptions.length +
    graphOptions.length;

  useEffect(() => {
    if (!open) {
      return;
    }
    setActiveIndex(0);
  }, [
    open,
    category,
    filter,
    connectFilter,
    hasStartNode,
    primitiveOptions,
    graphOptions,
    templateOptions,
    showCursorAgentRow,
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const el = itemRefs.current[activeIndex];
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const activateIndex = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= itemCount) {
        return;
      }
      let i = idx;
      for (const ty of primitiveOptions) {
        if (i === 0) {
          onPick({ kind: "primitive", nodeType: ty }, flowPos);
          onClose();
          return;
        }
        i -= 1;
      }
      if (showCursorAgentRow) {
        if (i === 0) {
          onPick({ kind: "task_cursor_agent" }, flowPos);
          onClose();
          return;
        }
        i -= 1;
      }
      for (const tid of templateOptions) {
        if (i === 0) {
          onPick({ kind: "template", templateId: tid }, flowPos);
          onClose();
          return;
        }
        i -= 1;
      }
      for (const row of graphOptions) {
        if (i === 0) {
          onPick({ kind: "graph_ref", targetGraphId: row.graphId }, flowPos);
          onClose();
          return;
        }
        i -= 1;
      }
    },
    [flowPos, graphOptions, itemCount, onClose, onPick, primitiveOptions, showCursorAgentRow, templateOptions],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        onClose();
        return;
      }
      if (itemCount === 0) {
        return;
      }
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        setActiveIndex((j) => (j + 1) % itemCount);
        return;
      }
      if (ev.key === "ArrowUp") {
        ev.preventDefault();
        setActiveIndex((j) => (j - 1 + itemCount) % itemCount);
        return;
      }
      if (ev.key === "Home") {
        ev.preventDefault();
        setActiveIndex(0);
        return;
      }
      if (ev.key === "End") {
        ev.preventDefault();
        setActiveIndex(itemCount - 1);
        return;
      }
      if (ev.key === "Enter") {
        if (isTextEditingTarget(ev.target)) {
          return;
        }
        ev.preventDefault();
        activateIndex(activeIndex);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [activateIndex, activeIndex, itemCount, onClose, open]);

  const setRefAt = useCallback((idx: number, el: HTMLButtonElement | null) => {
    itemRefs.current[idx] = el;
  }, []);

  if (!open) {
    return null;
  }

  const nestedEmptyWorkspace =
    category === "nested" && workspaceGraphs.length === 0 && filter.trim() === "";

  let refIdx = 0;
  const pushRef = (el: HTMLButtonElement | null) => {
    const i = refIdx;
    refIdx += 1;
    setRefAt(i, el);
  };

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
        ) : itemCount === 0 ? (
          <li className="gc-ctx-menu__empty">{t("app.canvas.addNodeNoMatch")}</li>
        ) : (
          <>
            {primitiveOptions.map((ty: AddMenuPrimitiveType, pi) => {
              const isK = activeIndex === pi;
              return (
                <li key={ty}>
                  <button
                    ref={(el) => {
                      pushRef(el);
                    }}
                    type="button"
                    className={`gc-ctx-menu__btn${isK ? " gc-ctx-menu__btn--keyboard-active" : ""}`}
                    role="menuitem"
                    onClick={() => {
                      onPick({ kind: "primitive", nodeType: ty }, flowPos);
                      onClose();
                    }}
                    onMouseEnter={() => {
                      setActiveIndex(pi);
                    }}
                  >
                    <span className="gc-ctx-menu__ty">{ty}</span>
                    <span className="gc-ctx-menu__lbl">{t(`app.canvas.nodeTypes.${ty}`)}</span>
                  </button>
                </li>
              );
            })}
            {showCursorAgentRow ? (
              <li key="__gc_cursor_agent">
                <button
                  ref={(el) => {
                    pushRef(el);
                  }}
                  type="button"
                  className={`gc-ctx-menu__btn${activeIndex === primitiveOptions.length ? " gc-ctx-menu__btn--keyboard-active" : ""}`}
                  role="menuitem"
                  onClick={() => {
                    onPick({ kind: "task_cursor_agent" }, flowPos);
                    onClose();
                  }}
                  onMouseEnter={() => {
                    setActiveIndex(primitiveOptions.length);
                  }}
                >
                  <span className="gc-ctx-menu__ty">task</span>
                  <span className="gc-ctx-menu__lbl">{t("app.canvas.addNodeCursorAgent")}</span>
                </button>
              </li>
            ) : null}
            {templateOptions.length > 0 ? (
              <>
                {primitiveOptions.length > 0 || showCursorAgentRow ? (
                  <li className="gc-ctx-menu__section" aria-hidden="true">
                    {t("app.canvas.addNodeTemplatesHeading")}
                  </li>
                ) : null}
                {templateOptions.map((tid, ti) => {
                  const idx = primitiveOptions.length + (showCursorAgentRow ? 1 : 0) + ti;
                  return (
                    <li key={`tpl-${tid}`}>
                      <button
                        ref={(el) => {
                          pushRef(el);
                        }}
                        type="button"
                        className={`gc-ctx-menu__btn${activeIndex === idx ? " gc-ctx-menu__btn--keyboard-active" : ""}`}
                        role="menuitem"
                        onClick={() => {
                          onPick({ kind: "template", templateId: tid }, flowPos);
                          onClose();
                        }}
                        onMouseEnter={() => {
                          setActiveIndex(idx);
                        }}
                      >
                        <span className="gc-ctx-menu__ty">template</span>
                        <span className="gc-ctx-menu__lbl">{t(`app.canvas.nodeTemplates.${tid}`)}</span>
                      </button>
                    </li>
                  );
                })}
              </>
            ) : null}
            {graphOptions.length > 0 ? (
              <>
                {primitiveOptions.length > 0 || showCursorAgentRow || templateOptions.length > 0 ? (
                  <li className="gc-ctx-menu__section" aria-hidden="true">
                    {t("app.canvas.addNodeGraphsHeading")}
                  </li>
                ) : null}
                {graphOptions.map((row, gi) => {
                  const idx =
                    primitiveOptions.length +
                    (showCursorAgentRow ? 1 : 0) +
                    templateOptions.length +
                    gi;
                  return (
                    <li key={row.fileName}>
                      <button
                        ref={(el) => {
                          pushRef(el);
                        }}
                        type="button"
                        className={`gc-ctx-menu__btn${activeIndex === idx ? " gc-ctx-menu__btn--keyboard-active" : ""}`}
                        role="menuitem"
                        onClick={() => {
                          onPick({ kind: "graph_ref", targetGraphId: row.graphId }, flowPos);
                          onClose();
                        }}
                        onMouseEnter={() => {
                          setActiveIndex(idx);
                        }}
                      >
                        <span className="gc-ctx-menu__ty">{GRAPH_NODE_TYPE_GRAPH_REF}</span>
                        <span className="gc-ctx-menu__lbl">{row.label}</span>
                      </button>
                    </li>
                  );
                })}
              </>
            ) : null}
          </>
        )}
      </ul>
    </div>
  );
}
