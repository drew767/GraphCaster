// Copyright Aura. All Rights Reserved.

import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import type { GraphCanvasSelection } from "./GraphCanvas";

type Props = {
  selection: GraphCanvasSelection | null;
  onApplyNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  onApplyEdgeCondition: (edgeId: string, condition: string | null) => void;
  workspaceLinked: boolean;
  onOpenNestedGraph?: (targetGraphId: string) => void;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function scalarGraphRefId(v: unknown): string {
  if (typeof v === "string" && v.trim() !== "") {
    return v.trim();
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  return "";
}

function graphRefTargetId(raw: Record<string, unknown>): string {
  const a = scalarGraphRefId(raw.targetGraphId);
  if (a !== "") {
    return a;
  }
  return scalarGraphRefId(raw.graphId);
}

export function InspectorPanel({
  selection,
  onApplyNodeData,
  onApplyEdgeCondition,
  workspaceLinked,
  onOpenNestedGraph,
}: Props) {
  const { t } = useTranslation();
  const [dataText, setDataText] = useState("{}");
  const [conditionText, setConditionText] = useState("");

  useEffect(() => {
    if (selection?.kind === "node") {
      setDataText(JSON.stringify(selection.raw, null, 2));
    } else if (selection?.kind === "edge") {
      setConditionText(selection.condition ?? "");
    } else {
      setDataText("{}");
      setConditionText("");
    }
  }, [selection]);

  const onSubmitNode = (e: FormEvent) => {
    e.preventDefault();
    if (!selection || selection.kind !== "node") {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(dataText);
    } catch {
      window.alert(t("app.inspector.dataParseError"));
      return;
    }
    if (!isPlainObject(parsed)) {
      window.alert(t("app.inspector.invalidDataJson"));
      return;
    }
    onApplyNodeData(selection.id, parsed);
  };

  const onSubmitEdge = (e: FormEvent) => {
    e.preventDefault();
    if (!selection || selection.kind !== "edge") {
      return;
    }
    const trimmed = conditionText.trim();
    onApplyEdgeCondition(selection.id, trimmed === "" ? null : trimmed);
  };

  return (
    <aside className="gc-inspector">
      <h2>{t("app.inspector.heading")}</h2>
      {selection?.kind === "node" ? (
        <div className="gc-inspector-detail">
          <div className="gc-inspector-row">
            <span className="gc-inspector-k">{t("app.inspector.nodeId")}</span>
            <span className="gc-inspector-v">{selection.id}</span>
          </div>
          <div className="gc-inspector-row">
            <span className="gc-inspector-k">{t("app.inspector.nodeType")}</span>
            <span className="gc-inspector-v">{selection.graphNodeType}</span>
          </div>
          <div className="gc-inspector-row">
            <span className="gc-inspector-k">{t("app.inspector.label")}</span>
            <span className="gc-inspector-v">{selection.label}</span>
          </div>
          {selection.graphNodeType === "graph_ref" ? (
            <div className="gc-inspector-graphref">
              <button
                type="button"
                className="gc-btn gc-btn-primary gc-inspector-apply"
                disabled={
                  !workspaceLinked ||
                  graphRefTargetId(selection.raw) === "" ||
                  onOpenNestedGraph == null
                }
                onClick={() => {
                  const tid = graphRefTargetId(selection.raw);
                  if (tid && onOpenNestedGraph) {
                    onOpenNestedGraph(tid);
                  }
                }}
              >
                {t("app.inspector.openGraphRef")}
              </button>
              {!workspaceLinked ? (
                <p className="gc-inspector-edge-hint">{t("app.inspector.openGraphRefNeedWorkspace")}</p>
              ) : null}
            </div>
          ) : null}
          <form className="gc-inspector-data-form" onSubmit={onSubmitNode}>
            <label className="gc-inspector-data-label" htmlFor="gc-inspector-data">
              {t("app.inspector.dataJson")}
            </label>
            <textarea
              id="gc-inspector-data"
              className="gc-inspector-data-textarea"
              value={dataText}
              onChange={(ev) => {
                setDataText(ev.target.value);
              }}
              spellCheck={false}
              autoComplete="off"
              rows={12}
            />
            <button type="submit" className="gc-btn gc-btn-primary gc-inspector-apply">
              {t("app.inspector.applyData")}
            </button>
          </form>
        </div>
      ) : selection?.kind === "edge" ? (
        <div className="gc-inspector-detail">
          <div className="gc-inspector-row">
            <span className="gc-inspector-k">{t("app.inspector.edgeId")}</span>
            <span className="gc-inspector-v">{selection.id}</span>
          </div>
          <div className="gc-inspector-row">
            <span className="gc-inspector-k">{t("app.inspector.edgeSource")}</span>
            <span className="gc-inspector-v">{selection.source}</span>
          </div>
          <div className="gc-inspector-row">
            <span className="gc-inspector-k">{t("app.inspector.edgeTarget")}</span>
            <span className="gc-inspector-v">{selection.target}</span>
          </div>
          <form className="gc-inspector-data-form" onSubmit={onSubmitEdge}>
            <label className="gc-inspector-data-label" htmlFor="gc-inspector-condition">
              {t("app.inspector.edgeCondition")}
            </label>
            <input
              id="gc-inspector-condition"
              className="gc-inspector-condition-input"
              type="text"
              value={conditionText}
              onChange={(ev) => {
                setConditionText(ev.target.value);
              }}
              spellCheck={false}
              autoComplete="off"
              placeholder={t("app.inspector.edgeConditionPlaceholder")}
            />
            <p className="gc-inspector-edge-hint">{t("app.inspector.edgeConditionHint")}</p>
            <button type="submit" className="gc-btn gc-btn-primary gc-inspector-apply">
              {t("app.inspector.applyEdgeCondition")}
            </button>
          </form>
        </div>
      ) : (
        <p>{t("app.inspector.hint")}</p>
      )}
    </aside>
  );
}
