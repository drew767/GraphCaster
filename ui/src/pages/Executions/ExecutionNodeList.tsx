// Copyright GraphCaster. All Rights Reserved.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ExecutionNodePayload } from "./executionsApi";
import { formatDurationMs, statusIconChar } from "./executionStatus";

type Props = {
  nodes: ExecutionNodePayload[];
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
};

export function ExecutionNodeList({ nodes, selectedNodeId, onSelect }: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) {
      return nodes;
    }
    return nodes.filter(
      (n) =>
        n.name.toLowerCase().includes(q) ||
        n.id.toLowerCase().includes(q) ||
        (n.type ?? "").toLowerCase().includes(q),
    );
  }, [filter, nodes]);

  return (
    <nav
      className="gc-exec-nodelist"
      aria-label={t("executions.detail.nodeList.aria")}
      data-testid="gc-exec-nodelist"
    >
      <header className="gc-exec-nodelist__header">
        <h3 className="gc-exec-nodelist__title">
          {t("executions.detail.nodeList.title", { count: nodes.length })}
        </h3>
        <input
          type="search"
          className="gc-exec-nodelist__filter"
          placeholder={t("executions.detail.nodeList.filterPlaceholder")}
          aria-label={t("executions.detail.nodeList.filterAria")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </header>
      <ul className="gc-exec-nodelist__list" role="listbox">
        {filtered.map((n) => {
          const selected = n.id === selectedNodeId;
          return (
            <li key={n.id}>
              <button
                type="button"
                className={`gc-exec-nodelist__item${selected ? " is-selected" : ""}`}
                role="option"
                aria-selected={selected}
                onClick={() => onSelect(n.id)}
                data-testid={`gc-exec-node-row-${n.id}`}
              >
                <span className="gc-exec-nodelist__icon" aria-hidden="true">
                  {statusIconChar(n.status)}
                </span>
                <span className="gc-exec-nodelist__name">{n.name}</span>
                <span className="gc-exec-nodelist__dur">
                  {formatDurationMs(n.durationMs)}
                </span>
              </button>
            </li>
          );
        })}
        {filtered.length === 0 ? (
          <li className="gc-exec-nodelist__empty">
            {t("executions.detail.nodeList.empty")}
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
