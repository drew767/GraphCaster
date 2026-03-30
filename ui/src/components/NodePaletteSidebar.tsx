// Copyright Aura. All Rights Reserved.

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ADD_NODE_CATEGORY_ORDER,
  computeAddNodeMenuLists,
  type AddMenuPrimitiveType,
  type AddNodeCategoryId,
  type AddNodeMenuPick,
  type WorkspaceGraphAddMenuRow,
} from "../graph/addNodeMenu";
import type { NodeTemplateId } from "../graph/nodeTemplates";
import { DraggableNodeItem } from "./DraggableNodeItem";
import "./NodePaletteSidebar.css";

export interface NodePaletteSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  hasStartNode: boolean;
  workspaceGraphs?: WorkspaceGraphAddMenuRow[];
  onNodeClick?: (pick: AddNodeMenuPick) => void;
}

export function NodePaletteSidebar({
  isOpen,
  onToggle,
  hasStartNode,
  workspaceGraphs = [],
  onNodeClick,
}: NodePaletteSidebarProps) {
  const { t } = useTranslation();
  const [filterText, setFilterText] = useState("");
  const [category, setCategory] = useState<AddNodeCategoryId>("all");

  const labelForPrimitive = useCallback(
    (nodeType: AddMenuPrimitiveType): string => {
      return t(`app.canvas.nodeTypes.${nodeType}`);
    },
    [t],
  );

  const labelForTemplate = useCallback(
    (id: NodeTemplateId) => {
      return t(`app.canvas.nodeTemplates.${id}`);
    },
    [t],
  );

  const { primitiveOptions, graphOptions, templateOptions } = useMemo(() => {
    return computeAddNodeMenuLists({
      category,
      filterText,
      hasStartNode,
      workspaceGraphs,
      labelForPrimitive,
      labelForTemplate,
    });
  }, [category, filterText, hasStartNode, labelForTemplate, workspaceGraphs, labelForPrimitive]);

  const handleFilterChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFilterText(e.target.value);
  }, []);

  const handleNodeClick = useCallback(
    (nodeType: AddMenuPrimitiveType) => {
      onNodeClick?.({ kind: "primitive", nodeType });
    },
    [onNodeClick],
  );

  const handleCategoryChange = useCallback((cat: AddNodeCategoryId) => {
    setCategory(cat);
  }, []);

  return (
    <aside
      className={`gc-node-palette-sidebar ${isOpen ? "gc-node-palette-sidebar--open" : "gc-node-palette-sidebar--collapsed"}`}
      role="complementary"
      aria-label={t("app.canvas.addNodeTitle")}
    >
      <button
        type="button"
        className="gc-node-palette-sidebar__toggle"
        onClick={onToggle}
        aria-label={t("app.canvas.nodePaletteToggle")}
        aria-expanded={isOpen}
      >
        {isOpen ? "«" : "»"}
      </button>

      {isOpen && (
        <div className="gc-node-palette-sidebar__content">
          <h2 className="gc-node-palette-sidebar__title">{t("app.canvas.addNodeTitle")}</h2>

          <input
            type="text"
            className="gc-node-palette-sidebar__search"
            placeholder={t("app.canvas.addNodeFilterPh")}
            value={filterText}
            onChange={handleFilterChange}
            aria-label={t("app.canvas.addNodeFilterPh")}
          />

          <div className="gc-node-palette-sidebar__categories" role="tablist">
            {ADD_NODE_CATEGORY_ORDER.map((cat) => (
              <button
                key={cat}
                type="button"
                role="tab"
                className={`gc-node-palette-sidebar__category-btn ${category === cat ? "gc-node-palette-sidebar__category-btn--active" : ""}`}
                onClick={() => handleCategoryChange(cat)}
                aria-selected={category === cat}
              >
                {t(`app.canvas.addNodeCategory.${cat}`)}
              </button>
            ))}
          </div>

          <ul className="gc-node-palette-sidebar__list" role="list">
            {primitiveOptions.map((nodeType) => (
              <DraggableNodeItem
                key={nodeType}
                nodeType={nodeType}
                label={labelForPrimitive(nodeType)}
                payload={{ kind: "primitive", nodeType }}
                onClick={() => handleNodeClick(nodeType)}
              />
            ))}
            {templateOptions.map((tid) => (
              <DraggableNodeItem
                key={`tpl-${tid}`}
                nodeType="template"
                label={labelForTemplate(tid)}
                payload={{ kind: "template", templateId: tid }}
                onClick={() => onNodeClick?.({ kind: "template", templateId: tid })}
              />
            ))}
            {graphOptions.map((graph) => (
              <DraggableNodeItem
                key={`graph-${graph.graphId}`}
                nodeType="graph_ref"
                label={graph.label}
                payload={{ kind: "graph_ref", targetGraphId: graph.graphId }}
                onClick={() => onNodeClick?.({ kind: "graph_ref", targetGraphId: graph.graphId })}
              />
            ))}
            {primitiveOptions.length === 0 &&
              graphOptions.length === 0 &&
              templateOptions.length === 0 && (
              <li className="gc-node-palette-sidebar__empty">
                {category === "nested" && workspaceGraphs.length === 0
                  ? t("app.canvas.addNodeNoGraphs")
                  : t("app.canvas.addNodeNoMatch")}
              </li>
            )}
          </ul>
        </div>
      )}
    </aside>
  );
}
