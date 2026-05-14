// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import type { GraphCanvasSelection } from "../canvas/graphCanvasSelection";
import type { GraphDocumentJson } from "../../graph/types";
import { GRAPH_NODE_TYPE_AI_ROUTE } from "../../graph/nodeKinds";
import { ExpressionAutocompleteInput } from "../ExpressionAutocompleteInput";

type EdgeSelection = Extract<GraphCanvasSelection, { kind: "edge" }>;

export type EdgeInspectorProps = {
  selection: EdgeSelection;
  graphDocument: GraphDocumentJson;
  expressionNodeIds: readonly string[];
  expressionEditorMonaco: boolean;
  setExpressionEditorMonaco: (value: boolean) => void;
  runLocked: boolean;
  onApplyEdgeCondition: (edgeId: string, condition: string | null) => void;
  onApplyEdgeData?: (edgeId: string, patch: { routeDescription: string }) => void;
};

export function EdgeInspector({
  selection,
  graphDocument,
  expressionNodeIds,
  expressionEditorMonaco,
  setExpressionEditorMonaco,
  runLocked,
  onApplyEdgeCondition,
  onApplyEdgeData,
}: EdgeInspectorProps) {
  const { t } = useTranslation();
  const [conditionText, setConditionText] = useState(selection.condition ?? "");
  const [edgeRouteDescriptionText, setEdgeRouteDescriptionText] = useState(
    selection.routeDescription ?? "",
  );

  useEffect(() => {
    setConditionText(selection.condition ?? "");
    setEdgeRouteDescriptionText(selection.routeDescription ?? "");
  }, [selection.id, selection.condition, selection.routeDescription]);

  const edgeFromAiRoute = (() => {
    const n = graphDocument.nodes?.find((x) => x.id === selection.source);
    return n?.type === GRAPH_NODE_TYPE_AI_ROUTE;
  })();

  const expressionEditorMode = expressionEditorMonaco ? "monaco" : "native";

  const onSubmitEdge = (e: FormEvent) => {
    e.preventDefault();
    if (runLocked) {
      return;
    }
    const trimmed = conditionText.trim();
    onApplyEdgeCondition(selection.id, trimmed === "" ? null : trimmed);
  };

  const onSubmitEdgeRouteDescription = (e: FormEvent) => {
    e.preventDefault();
    if (runLocked || onApplyEdgeData == null) {
      return;
    }
    if (!edgeFromAiRoute) {
      return;
    }
    onApplyEdgeData(selection.id, { routeDescription: edgeRouteDescriptionText });
  };

  return (
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
      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-k" htmlFor="gc-inspector-expr-monaco-edge">
          {t("app.inspector.expressionMonaco")}
        </label>
        <input
          id="gc-inspector-expr-monaco-edge"
          type="checkbox"
          disabled={runLocked}
          checked={expressionEditorMonaco}
          onChange={(ev) => {
            const v = ev.target.checked;
            setExpressionEditorMonaco(v);
            try {
              globalThis.localStorage?.setItem("gc.inspector.expressionMonaco", v ? "1" : "0");
            } catch {
              /* ignore */
            }
          }}
        />
      </div>
      <form className="gc-inspector-data-form" onSubmit={onSubmitEdge}>
        <label className="gc-inspector-data-label" htmlFor="gc-inspector-condition">
          {t("app.inspector.edgeCondition")}
        </label>
        <ExpressionAutocompleteInput
          key={`edge-cond-${selection.id}`}
          id="gc-inspector-condition"
          className="gc-inspector-condition-input"
          value={conditionText}
          onChange={setConditionText}
          readOnly={runLocked}
          spellCheck={false}
          placeholder={t("app.inspector.edgeConditionPlaceholder")}
          nodeIds={expressionNodeIds}
          editor={expressionEditorMode}
        />
        <p className="gc-inspector-edge-hint">{t("app.inspector.edgeConditionHint")}</p>
        <p className="gc-inspector-edge-hint">{t("app.inspector.expressionAutocompleteHint")}</p>
        <button
          type="submit"
          className="gc-btn gc-btn-primary gc-inspector-apply"
          disabled={runLocked}
        >
          {t("app.inspector.applyEdgeCondition")}
        </button>
      </form>
      {edgeFromAiRoute && onApplyEdgeData != null ? (
        <form className="gc-inspector-data-form" onSubmit={onSubmitEdgeRouteDescription}>
          <label className="gc-inspector-data-label" htmlFor="gc-inspector-edge-route-desc">
            {t("app.inspector.edgeRouteDescription")}
          </label>
          <textarea
            id="gc-inspector-edge-route-desc"
            className="gc-inspector-data-textarea"
            value={edgeRouteDescriptionText}
            onChange={(ev) => {
              setEdgeRouteDescriptionText(ev.target.value);
            }}
            readOnly={runLocked}
            spellCheck
            autoComplete="off"
            rows={3}
            maxLength={1024}
          />
          <p className="gc-inspector-edge-hint">{t("app.inspector.edgeRouteDescriptionHint")}</p>
          <button
            type="submit"
            className="gc-btn gc-btn-primary gc-inspector-apply"
            disabled={runLocked}
          >
            {t("app.inspector.applyEdgeRouteDescription")}
          </button>
        </form>
      ) : null}
    </div>
  );
}
