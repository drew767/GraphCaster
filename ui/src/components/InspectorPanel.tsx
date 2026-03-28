// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import type { GraphCanvasSelection } from "./GraphCanvas";
import type { GraphDocumentJson, GraphDocumentSettingsPatch } from "../graph/types";
import { graphIdFromDocument } from "../graph/parseDocument";
import {
  GRAPH_NODE_TYPE_AI_ROUTE,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_TASK,
} from "../graph/nodeKinds";
import { runSessionAppendLine, useRunSession } from "../run/runSessionStore";
import {
  getStepCacheDirtySnapshot,
  markStepCacheDirtyTransitive,
} from "../run/stepCacheDirtyStore";
import { mergeModeFromNodeData } from "../graph/structureWarnings";
import {
  type AppMessagePresentation,
  presentationForInspectorJsonSyntaxError,
  presentationForInspectorSimple,
} from "../graph/openGraphErrorPresentation";
import { safeExternalHttpUrl } from "../lib/safeExternalUrl";

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
  onMarkStepCacheDirtyTransitive?: (doc: GraphDocumentJson, seeds: readonly string[]) => void;
  runLocked?: boolean;
  onRunUntilThisNode?: () => void;
  runUntilThisNodeEnabled?: boolean;
  onUserMessage?: (presentation: AppMessagePresentation) => void;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

const GCPIN_PAYLOAD_WARN_BYTES = 262144;

function payloadForGcPin(snapshot: Record<string, unknown>): Record<string, unknown> {
  const pr = snapshot.processResult;
  if (isPlainObject(pr)) {
    return { processResult: { ...pr } };
  }
  return { ...snapshot };
}

function estimateJsonUtf8Bytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
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

function inputsOutputsFromDoc(doc: GraphDocumentJson): { inputsText: string; outputsText: string } {
  const ins = doc.inputs;
  const outs = doc.outputs;
  return {
    inputsText:
      ins === undefined ? "[]" : JSON.stringify(ins, null, 2),
    outputsText:
      outs === undefined ? "[]" : JSON.stringify(outs, null, 2),
  };
}

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
  onMarkStepCacheDirtyTransitive,
  runLocked = false,
  onRunUntilThisNode,
  runUntilThisNodeEnabled = false,
  onUserMessage,
}: Props) {
  const { t } = useTranslation();
  const runSession = useRunSession();
  const [dataText, setDataText] = useState("{}");
  const [conditionText, setConditionText] = useState("");
  const [edgeRouteDescriptionText, setEdgeRouteDescriptionText] = useState("");

  const [graphTitle, setGraphTitle] = useState("");
  const [graphAuthor, setGraphAuthor] = useState("");
  const [graphSchemaVersion, setGraphSchemaVersion] = useState("1");
  const [graphInputsText, setGraphInputsText] = useState("[]");
  const [graphOutputsText, setGraphOutputsText] = useState("[]");

  const graphDocSyncKey = useMemo(() => {
    return JSON.stringify({
      title: graphDocument.meta?.title ?? "",
      gid: graphIdFromDocument(graphDocument) ?? "",
      author: graphDocument.meta?.author ?? "",
      sv: graphDocument.schemaVersion ?? graphDocument.meta?.schemaVersion ?? 1,
      inputs: graphDocument.inputs,
      outputs: graphDocument.outputs,
    });
  }, [graphDocument]);

  useEffect(() => {
    if (selection?.kind === "node") {
      setDataText(JSON.stringify(selection.raw, null, 2));
    } else if (selection?.kind === "edge") {
      setConditionText(selection.condition ?? "");
      setEdgeRouteDescriptionText(selection.routeDescription ?? "");
    } else {
      setDataText("{}");
      setConditionText("");
      setEdgeRouteDescriptionText("");
    }
  }, [selection]);

  const edgeFromAiRoute = useMemo(() => {
    if (selection?.kind !== "edge") {
      return false;
    }
    const n = graphDocument.nodes?.find((x) => x.id === selection.source);
    return n?.type === GRAPH_NODE_TYPE_AI_ROUTE;
  }, [selection, graphDocument.nodes]);

  const aiRouteEndpointHref = useMemo(() => {
    if (selection?.kind !== "node" || selection.graphNodeType !== GRAPH_NODE_TYPE_AI_ROUTE) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(dataText);
      if (isPlainObject(parsed) && Object.prototype.hasOwnProperty.call(parsed, "endpointUrl")) {
        return safeExternalHttpUrl(parsed.endpointUrl);
      }
    } catch {
      /* keep saved document as fallback below */
    }
    const raw = selection.raw;
    return isPlainObject(raw) ? safeExternalHttpUrl(raw.endpointUrl) : null;
  }, [dataText, selection]);

  const showInspectorError = (presentation: AppMessagePresentation, legacyAlertKey: string) => {
    if (onUserMessage) {
      onUserMessage(presentation);
    } else {
      window.alert(t(legacyAlertKey));
    }
  };

  useEffect(() => {
    if (selection != null) {
      return;
    }
    const { inputsText, outputsText } = inputsOutputsFromDoc(graphDocument);
    setGraphTitle(graphDocument.meta?.title ?? "");
    setGraphAuthor(typeof graphDocument.meta?.author === "string" ? graphDocument.meta.author : "");
    const sv = graphDocument.schemaVersion ?? graphDocument.meta?.schemaVersion ?? 1;
    setGraphSchemaVersion(String(sv));
    setGraphInputsText(inputsText);
    setGraphOutputsText(outputsText);
  }, [selection, graphDocSyncKey]);

  const onSubmitNode = (e: FormEvent) => {
    e.preventDefault();
    if (runLocked) {
      return;
    }
    if (!selection || selection.kind !== "node") {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(dataText);
    } catch (err) {
      showInspectorError(
        presentationForInspectorJsonSyntaxError(t, err),
        "app.inspector.dataParseError",
      );
      return;
    }
    if (!isPlainObject(parsed)) {
      showInspectorError(
        presentationForInspectorSimple(t, "app.inspector.invalidDataJson"),
        "app.inspector.invalidDataJson",
      );
      return;
    }
    onApplyNodeData(selection.id, parsed);
  };

  const onSubmitEdge = (e: FormEvent) => {
    e.preventDefault();
    if (runLocked) {
      return;
    }
    if (!selection || selection.kind !== "edge") {
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
    if (!selection || selection.kind !== "edge" || !edgeFromAiRoute) {
      return;
    }
    onApplyEdgeData(selection.id, { routeDescription: edgeRouteDescriptionText });
  };

  const onSubmitGraph = (e: FormEvent) => {
    e.preventDefault();
    if (runLocked) {
      return;
    }
    let inputsParsed: unknown | undefined;
    let outputsParsed: unknown | undefined;
    if (graphInputsText.trim() === "") {
      inputsParsed = undefined;
    } else {
      try {
        inputsParsed = JSON.parse(graphInputsText);
      } catch (err) {
        showInspectorError(
          presentationForInspectorJsonSyntaxError(t, err),
          "app.inspector.dataParseError",
        );
        return;
      }
    }
    if (graphOutputsText.trim() === "") {
      outputsParsed = undefined;
    } else {
      try {
        outputsParsed = JSON.parse(graphOutputsText);
      } catch (err) {
        showInspectorError(
          presentationForInspectorJsonSyntaxError(t, err),
          "app.inspector.dataParseError",
        );
        return;
      }
    }
    if (
      inputsParsed !== undefined &&
      !Array.isArray(inputsParsed) &&
      !isPlainObject(inputsParsed)
    ) {
      showInspectorError(
        presentationForInspectorSimple(t, "app.inspector.graphParamsInvalidJson"),
        "app.inspector.graphParamsInvalidJson",
      );
      return;
    }
    if (
      outputsParsed !== undefined &&
      !Array.isArray(outputsParsed) &&
      !isPlainObject(outputsParsed)
    ) {
      showInspectorError(
        presentationForInspectorSimple(t, "app.inspector.graphParamsInvalidJson"),
        "app.inspector.graphParamsInvalidJson",
      );
      return;
    }
    const svRaw = graphSchemaVersion.trim();
    let schemaVersion: number;
    if (svRaw === "") {
      schemaVersion = 1;
    } else {
      const n = Number.parseInt(svRaw, 10);
      if (!Number.isFinite(n)) {
        showInspectorError(
          presentationForInspectorSimple(t, "app.inspector.graphSchemaInvalid"),
          "app.inspector.graphSchemaInvalid",
        );
        return;
      }
      schemaVersion = n;
    }
    const patch: GraphDocumentSettingsPatch = {
      title: graphTitle,
      author: graphAuthor,
      schemaVersion,
      inputs: inputsParsed,
      outputs: outputsParsed,
    };
    onApplyGraphDocumentSettings(patch);
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
          {selection.graphNodeType === GRAPH_NODE_TYPE_MERGE ? (
            <div className="gc-inspector-row gc-inspector-row--field">
              <label className="gc-inspector-k" htmlFor="gc-inspector-merge-mode">
                {t("app.inspector.mergeMode")}
              </label>
              <select
                id="gc-inspector-merge-mode"
                className="gc-inspector-condition-input"
                disabled={runLocked}
                value={mergeModeFromNodeData(selection.raw)}
                onChange={(ev) => {
                  const mode = ev.target.value === "barrier" ? "barrier" : "passthrough";
                  onApplyNodeData(selection.id, {
                    ...(isPlainObject(selection.raw) ? selection.raw : {}),
                    mode,
                  });
                }}
              >
                <option value="passthrough">{t("app.inspector.mergeModePassthrough")}</option>
                <option value="barrier">{t("app.inspector.mergeModeBarrier")}</option>
              </select>
              <p className="gc-inspector-edge-hint">{t("app.inspector.mergeModeHint")}</p>
            </div>
          ) : null}
          {aiRouteEndpointHref != null ? (
            <div className="gc-inspector-url-row">
              <a
                href={aiRouteEndpointHref}
                target="_blank"
                rel="noopener noreferrer"
                className="gc-inspector-external-link"
              >
                {t("app.inspector.openEndpointUrl")}
              </a>
              <span className="gc-inspector-url-preview" title={aiRouteEndpointHref}>
                {aiRouteEndpointHref.length > 72 ? `${aiRouteEndpointHref.slice(0, 69)}…` : aiRouteEndpointHref}
              </span>
            </div>
          ) : null}
          {selection.graphNodeType === GRAPH_NODE_TYPE_TASK ? (
            <>
            <div className="gc-inspector-pin">
              <div className="gc-inspector-row gc-inspector-row--field">
                <span className="gc-inspector-k">{t("app.inspector.pinHeading")}</span>
                <label className="gc-inspector-pin-toggle">
                  <input
                    type="checkbox"
                    disabled={runLocked}
                    checked={
                      isPlainObject(selection.raw.gcPin) &&
                      selection.raw.gcPin.enabled === true
                    }
                    onChange={(ev) => {
                      const base = isPlainObject(selection.raw) ? selection.raw : {};
                      const prev = isPlainObject(base.gcPin) ? base.gcPin : {};
                      onApplyNodeData(selection.id, {
                        ...base,
                        gcPin: { ...prev, enabled: ev.target.checked },
                      });
                    }}
                  />
                  <span>{t("app.inspector.pinEnabled")}</span>
                </label>
              </div>
              <div className="gc-inspector-pin-actions">
                <button
                  type="button"
                  className="gc-btn gc-inspector-apply"
                  disabled={
                    runLocked ||
                    runSession.nodeOutputSnapshots[selection.id] === undefined
                  }
                  onClick={() => {
                    const snap = runSession.nodeOutputSnapshots[selection.id];
                    if (snap === undefined) {
                      return;
                    }
                    const base = isPlainObject(selection.raw) ? selection.raw : {};
                    const payload = payloadForGcPin(snap);
                    onApplyNodeData(selection.id, {
                      ...base,
                      gcPin: { enabled: true, payload },
                    });
                  }}
                >
                  {t("app.inspector.pinFromLastRun")}
                </button>
                <button
                  type="button"
                  className="gc-btn gc-inspector-apply"
                  disabled={runLocked || !isPlainObject(selection.raw.gcPin)}
                  onClick={() => {
                    const base = isPlainObject(selection.raw) ? { ...selection.raw } : {};
                    delete base.gcPin;
                    onApplyNodeData(selection.id, base);
                  }}
                >
                  {t("app.inspector.pinClear")}
                </button>
              </div>
              {(() => {
                const pin = selection.raw.gcPin;
                if (!isPlainObject(pin)) {
                  return null;
                }
                const pl = pin.payload;
                if (pl === undefined) {
                  return null;
                }
                const n = estimateJsonUtf8Bytes(pl);
                if (n <= GCPIN_PAYLOAD_WARN_BYTES) {
                  return null;
                }
                return (
                  <p className="gc-inspector-edge-hint">{t("app.inspector.pinPayloadLarge", { kb: Math.ceil(n / 1024) })}</p>
                );
              })()}
              <p className="gc-inspector-edge-hint">{t("app.inspector.pinHint")}</p>
            </div>
            <div className="gc-inspector-pin">
              <div className="gc-inspector-row gc-inspector-row--field">
                <span className="gc-inspector-k">{t("app.inspector.stepCacheHeading")}</span>
                <label className="gc-inspector-pin-toggle">
                  <input
                    type="checkbox"
                    disabled={runLocked}
                    checked={
                      isPlainObject(selection.raw) && selection.raw.stepCache === true
                    }
                    onChange={(ev) => {
                      const base = isPlainObject(selection.raw) ? { ...selection.raw } : {};
                      if (ev.target.checked) {
                        base.stepCache = true;
                      } else {
                        delete base.stepCache;
                      }
                      onApplyNodeData(selection.id, base);
                    }}
                  />
                  <span>{t("app.inspector.stepCacheEnabled")}</span>
                </label>
              </div>
              <div className="gc-inspector-pin-actions">
                <button
                  type="button"
                  className="gc-btn gc-inspector-apply"
                  disabled={runLocked}
                  onClick={() => {
                    const doc = getDocumentForStepCacheDirty?.() ?? graphDocument;
                    const before = new Set(getStepCacheDirtySnapshot().ids);
                    const mark =
                      onMarkStepCacheDirtyTransitive ??
                      ((d: GraphDocumentJson, s: readonly string[]) =>
                        markStepCacheDirtyTransitive(d, s));
                    mark(doc, [selection.id]);
                    const snap = getStepCacheDirtySnapshot();
                    const added = snap.ids.filter((id) => !before.has(id));
                    runSessionAppendLine(
                      `[host] step-cache dirty +${added.length} [${added.join(",")}] → queue ${snap.ids.length}: ${snap.ids.join(",")}`,
                    );
                  }}
                >
                  {t("app.inspector.stepCacheMarkDirty")}
                </button>
              </div>
              <p className="gc-inspector-edge-hint">{t("app.inspector.stepCacheHint")}</p>
            </div>
            </>
          ) : null}
          {selection.graphNodeType === "comment" ? (
            <p className="gc-inspector-edge-hint">{t("app.inspector.commentFrameHint")}</p>
          ) : null}
          {selection.graphNodeType === "graph_ref" ? (
            <div className="gc-inspector-graphref">
              <button
                type="button"
                className="gc-btn gc-btn-primary gc-inspector-apply"
                disabled={
                  runLocked ||
                  !workspaceLinked ||
                  graphRefTargetId(selection.raw) === "" ||
                  onOpenNestedGraph == null
                }
                onClick={() => {
                  const tid = graphRefTargetId(selection.raw);
                  if (tid && onOpenNestedGraph) {
                    onOpenNestedGraph(tid, selection.id);
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
          {onRunUntilThisNode != null && selection.graphNodeType !== "start" ? (
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
              readOnly={runLocked}
              spellCheck={false}
              autoComplete="off"
              rows={12}
            />
            <button
              type="submit"
              className="gc-btn gc-btn-primary gc-inspector-apply"
              disabled={runLocked}
            >
              {t("app.inspector.applyData")}
            </button>
          </form>
        </div>
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
              readOnly={runLocked}
              spellCheck={false}
              autoComplete="off"
              placeholder={t("app.inspector.edgeConditionPlaceholder")}
            />
            <p className="gc-inspector-edge-hint">{t("app.inspector.edgeConditionHint")}</p>
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
      ) : (
        <div className="gc-inspector-detail">
          <p className="gc-inspector-hint-line">{t("app.inspector.hint")}</p>
          <h3 className="gc-inspector-subheading">{t("app.inspector.graphSection")}</h3>
          <form className="gc-inspector-data-form" onSubmit={onSubmitGraph}>
            <label className="gc-inspector-data-label" htmlFor="gc-inspector-graph-title">
              {t("app.inspector.graphTitle")}
            </label>
            <input
              id="gc-inspector-graph-title"
              className="gc-inspector-condition-input"
              type="text"
              value={graphTitle}
              onChange={(ev) => {
                setGraphTitle(ev.target.value);
              }}
              readOnly={runLocked}
              autoComplete="off"
            />
            <span className="gc-inspector-data-label">{t("app.inspector.graphId")}</span>
            <div
              className="gc-inspector-readonly gc-inspector-mono"
              aria-label={t("app.inspector.graphId")}
            >
              {graphIdFromDocument(graphDocument) ?? "—"}
            </div>
            <label className="gc-inspector-data-label" htmlFor="gc-inspector-graph-author">
              {t("app.inspector.graphAuthor")}
            </label>
            <input
              id="gc-inspector-graph-author"
              className="gc-inspector-condition-input"
              type="text"
              value={graphAuthor}
              onChange={(ev) => {
                setGraphAuthor(ev.target.value);
              }}
              readOnly={runLocked}
              autoComplete="off"
            />
            <label className="gc-inspector-data-label" htmlFor="gc-inspector-graph-sv">
              {t("app.inspector.graphSchemaVersion")}
            </label>
            <input
              id="gc-inspector-graph-sv"
              className="gc-inspector-condition-input"
              type="text"
              inputMode="numeric"
              value={graphSchemaVersion}
              onChange={(ev) => {
                setGraphSchemaVersion(ev.target.value);
              }}
              readOnly={runLocked}
              autoComplete="off"
            />
            <label className="gc-inspector-data-label" htmlFor="gc-inspector-graph-inputs">
              {t("app.inspector.graphInputs")}
            </label>
            <textarea
              id="gc-inspector-graph-inputs"
              className="gc-inspector-data-textarea"
              value={graphInputsText}
              onChange={(ev) => {
                setGraphInputsText(ev.target.value);
              }}
              readOnly={runLocked}
              spellCheck={false}
              autoComplete="off"
              rows={6}
            />
            <p className="gc-inspector-edge-hint">{t("app.inspector.graphInputsHint")}</p>
            <label className="gc-inspector-data-label" htmlFor="gc-inspector-graph-outputs">
              {t("app.inspector.graphOutputs")}
            </label>
            <textarea
              id="gc-inspector-graph-outputs"
              className="gc-inspector-data-textarea"
              value={graphOutputsText}
              onChange={(ev) => {
                setGraphOutputsText(ev.target.value);
              }}
              readOnly={runLocked}
              spellCheck={false}
              autoComplete="off"
              rows={6}
            />
            <p className="gc-inspector-edge-hint">{t("app.inspector.graphOutputsHint")}</p>
            <button
              type="submit"
              className="gc-btn gc-btn-primary gc-inspector-apply"
              disabled={runLocked}
            >
              {t("app.inspector.applyGraph")}
            </button>
          </form>
        </div>
      )}
    </aside>
  );
}
