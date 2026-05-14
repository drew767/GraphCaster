// Copyright GraphCaster. All Rights Reserved.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { GraphCanvasSelection } from "./GraphCanvas";
import type { GraphDocumentJson, GraphDocumentSettingsPatch } from "../graph/types";
import type {
  AppMessagePresentation,
} from "../graph/openGraphErrorPresentation";
import type { GraphRefSnapshotLoadResult } from "../graph/graphRefLazySnapshot";
import { NodeInspector } from "./inspector/NodeInspector";
import { EdgeInspector } from "./inspector/EdgeInspector";
import { GraphSettingsInspector } from "./inspector/GraphSettingsInspector";

type Props = {
  selection: GraphCanvasSelection | null;
  graphDocument: GraphDocumentJson;
  getDocumentForStepCacheDirty?: () => GraphDocumentJson;
  onApplyGraphDocumentSettings: (patch: GraphDocumentSettingsPatch) => void;
  onApplyNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  onApplyEdgeCondition: (edgeId: string, condition: string | null) => void;
  onApplyEdgeData?: (edgeId: string, patch: { routeDescription: string }) => void;
  onRemoveNodes?: (ids: readonly string[]) => void;
  workspaceLinked: boolean;
  onOpenNestedGraph?: (targetGraphId: string, graphRefNodeId?: string) => void;
  loadGraphRefSnapshot?: (
    targetGraphId: string,
    options?: { force?: boolean },
  ) => Promise<GraphRefSnapshotLoadResult>;
  getGraphRefWorkspaceHint?: (
    targetGraphId: string,
  ) => { title?: string; fileName: string; duplicateGraphId: boolean } | null;
  onMarkStepCacheDirtyTransitive?: (doc: GraphDocumentJson, seeds: readonly string[]) => void;
  runLocked?: boolean;
  onRunUntilThisNode?: () => void;
  runUntilThisNodeEnabled?: boolean;
  onUserMessage?: (presentation: AppMessagePresentation) => void;
};

export function InspectorPanel({
  selection,
  graphDocument,
  getDocumentForStepCacheDirty,
  onApplyGraphDocumentSettings,
  onApplyNodeData,
  onApplyEdgeCondition,
  onApplyEdgeData,
  onRemoveNodes,
  workspaceLinked,
  onOpenNestedGraph,
  loadGraphRefSnapshot,
  getGraphRefWorkspaceHint,
  onMarkStepCacheDirtyTransitive,
  runLocked = false,
  onRunUntilThisNode,
  runUntilThisNodeEnabled = false,
  onUserMessage,
}: Props) {
  const { t } = useTranslation();
  const expressionNodeIds = useMemo(
    () => graphDocument.nodes?.map((n) => n.id) ?? [],
    [graphDocument.nodes],
  );
  const [expressionEditorMonaco, setExpressionEditorMonaco] = useState(() => {
    try {
      return (
        typeof globalThis.localStorage !== "undefined" &&
        globalThis.localStorage.getItem("gc.inspector.expressionMonaco") === "1"
      );
    } catch {
      return false;
    }
  });

  return (
    <aside className="gc-inspector">
      <h2>{t("app.inspector.heading")}</h2>
      {selection?.kind === "node" ? (
        <NodeInspector
          selection={selection}
          graphDocument={graphDocument}
          expressionNodeIds={expressionNodeIds}
          expressionEditorMonaco={expressionEditorMonaco}
          setExpressionEditorMonaco={setExpressionEditorMonaco}
          runLocked={runLocked}
          workspaceLinked={workspaceLinked}
          onApplyNodeData={onApplyNodeData}
          onUserMessage={onUserMessage}
          onOpenNestedGraph={onOpenNestedGraph}
          loadGraphRefSnapshot={loadGraphRefSnapshot}
          getGraphRefWorkspaceHint={getGraphRefWorkspaceHint}
          getDocumentForStepCacheDirty={getDocumentForStepCacheDirty}
          onMarkStepCacheDirtyTransitive={onMarkStepCacheDirtyTransitive}
          onRunUntilThisNode={onRunUntilThisNode}
          runUntilThisNodeEnabled={runUntilThisNodeEnabled}
        />
      ) : selection?.kind === "multiNode" ? (
        <div className="gc-inspector-detail">
          <p className="gc-inspector-hint-line">{t("app.inspector.multiHint")}</p>
          <div className="gc-inspector-row">
            <span className="gc-inspector-k">{t("app.inspector.multiCount")}</span>
            <span className="gc-inspector-v">{selection.ids.length}</span>
          </div>
          <ul className="gc-inspector-multilist">
            {selection.nodes.map((row) => (
              <li key={row.id} className="gc-inspector-multilist-item">
                <span className="gc-inspector-mono">{row.id}</span>
                <span className="gc-inspector-multilist-meta">
                  {row.graphNodeType} — {row.label}
                </span>
              </li>
            ))}
          </ul>
          {onRunUntilThisNode != null &&
          selection.ids.length === 1 &&
          selection.nodes[0]?.graphNodeType !== "start" ? (
            <div className="gc-inspector-graphref">
              <button
                type="button"
                className="gc-btn gc-inspector-apply"
                disabled={runLocked || !runUntilThisNodeEnabled}
                onClick={() => {
                  onRunUntilThisNode();
                }}
              >
                {t("app.inspector.runUntilThisNode")}
              </button>
              <p className="gc-inspector-edge-hint">{t("app.inspector.runUntilThisNodeHint")}</p>
            </div>
          ) : null}
          <button
            type="button"
            className="gc-btn gc-btn-danger gc-inspector-apply"
            disabled={runLocked || onRemoveNodes == null}
            onClick={() => {
              onRemoveNodes?.(selection.ids);
            }}
          >
            {t("app.inspector.deleteSelected")}
          </button>
        </div>
      ) : selection?.kind === "edge" ? (
        <EdgeInspector
          selection={selection}
          graphDocument={graphDocument}
          expressionNodeIds={expressionNodeIds}
          expressionEditorMonaco={expressionEditorMonaco}
          setExpressionEditorMonaco={setExpressionEditorMonaco}
          runLocked={runLocked}
          onApplyEdgeCondition={onApplyEdgeCondition}
          onApplyEdgeData={onApplyEdgeData}
        />
      ) : (
        <GraphSettingsInspector
          graphDocument={graphDocument}
          runLocked={runLocked}
          onApplyGraphDocumentSettings={onApplyGraphDocumentSettings}
          onUserMessage={onUserMessage}
        />
      )}
    </aside>
  );
}
