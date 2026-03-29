// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import type { GraphCanvasSelection } from "./GraphCanvas";
import type { GraphDocumentJson, GraphDocumentSettingsPatch } from "../graph/types";
import { graphIdFromDocument } from "../graph/parseDocument";
import {
  GRAPH_NODE_TYPE_AI_ROUTE,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_MCP_TOOL,
  GRAPH_NODE_TYPE_LLM_AGENT,
  GRAPH_NODE_TYPE_GROUP,
  GRAPH_NODE_TYPE_TASK,
  isGraphDocumentFrameType,
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
import {
  buildGcCursorAgentPayload,
  cursorAgentUiValidationKey,
  parseExtraArgsJson,
  type GcCursorAgentCwdBase,
} from "../graph/cursorAgentPreset";
import type { GraphRefSnapshotLoadResult } from "../graph/graphRefLazySnapshot";

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
  loadGraphRefSnapshot,
  getGraphRefWorkspaceHint,
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

  const [caEnabled, setCaEnabled] = useState(false);
  const [caPrompt, setCaPrompt] = useState("");
  const [caPromptFile, setCaPromptFile] = useState("");
  const [caCwdBase, setCaCwdBase] = useState<GcCursorAgentCwdBase>("workspace_root");
  const [caCwdRelative, setCaCwdRelative] = useState("");
  const [caModel, setCaModel] = useState("");
  const [caOutputFormat, setCaOutputFormat] = useState("");
  const [caExtraArgsJson, setCaExtraArgsJson] = useState("");
  const [caPrintMode, setCaPrintMode] = useState(true);
  const [caApplyFileChanges, setCaApplyFileChanges] = useState(false);

  const [mcpTransport, setMcpTransport] = useState<"stdio" | "streamable_http">("stdio");
  const [mcpToolName, setMcpToolName] = useState("");
  const [mcpTimeoutSec, setMcpTimeoutSec] = useState("60");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpServerUrl, setMcpServerUrl] = useState("");
  const [mcpAllowInsecure, setMcpAllowInsecure] = useState(false);
  const [mcpBearerKey, setMcpBearerKey] = useState("");
  const [mcpArgsJson, setMcpArgsJson] = useState("{}");

  const [llmCommand, setLlmCommand] = useState("");
  const [llmCwd, setLlmCwd] = useState("");
  const [llmTimeoutSec, setLlmTimeoutSec] = useState("600");
  const [llmMaxSteps, setLlmMaxSteps] = useState("0");
  const [llmEnvKeysCsv, setLlmEnvKeysCsv] = useState("");
  const [llmInputPayloadJson, setLlmInputPayloadJson] = useState("{}");

  const [graphTitle, setGraphTitle] = useState("");
  const [graphAuthor, setGraphAuthor] = useState("");
  const [graphSchemaVersion, setGraphSchemaVersion] = useState("1");
  const [graphInputsText, setGraphInputsText] = useState("[]");
  const [graphOutputsText, setGraphOutputsText] = useState("[]");

  const [graphRefPreviewOpen, setGraphRefPreviewOpen] = useState(false);
  const [graphRefPreviewLoading, setGraphRefPreviewLoading] = useState(false);
  const [graphRefPreviewResult, setGraphRefPreviewResult] = useState<GraphRefSnapshotLoadResult | null>(
    null,
  );
  const graphRefPreviewGenRef = useRef(0);

  const graphRefInspectorKey = useMemo(() => {
    if (selection?.kind !== "node" || selection.graphNodeType !== "graph_ref") {
      return "";
    }
    return `${selection.id}\0${graphRefTargetId(selection.raw)}`;
  }, [selection]);

  const graphRefSelectionTargetId = useMemo(() => {
    if (selection?.kind !== "node" || selection.graphNodeType !== "graph_ref") {
      return "";
    }
    return graphRefTargetId(selection.raw);
  }, [selection]);

  type GraphRefWorkspaceHintState =
    | { kind: "noop" }
    | { kind: "missing" }
    | { kind: "ok"; hint: { title?: string; fileName: string; duplicateGraphId: boolean } };

  const graphRefWorkspaceHintState = useMemo((): GraphRefWorkspaceHintState => {
    if (graphRefSelectionTargetId === "" || !getGraphRefWorkspaceHint) {
      return { kind: "noop" };
    }
    const h = getGraphRefWorkspaceHint(graphRefSelectionTargetId);
    if (!h) {
      return { kind: "missing" };
    }
    return { kind: "ok", hint: h };
  }, [getGraphRefWorkspaceHint, graphRefSelectionTargetId]);

  const graphRefPreviewBlocked = graphRefWorkspaceHintState.kind === "missing";

  useEffect(() => {
    graphRefPreviewGenRef.current += 1;
    const genAtStart = graphRefPreviewGenRef.current;
    setGraphRefPreviewOpen(false);
    setGraphRefPreviewLoading(false);
    setGraphRefPreviewResult(null);

    if (
      graphRefInspectorKey === "" ||
      graphRefPreviewBlocked ||
      loadGraphRefSnapshot == null ||
      graphRefSelectionTargetId === ""
    ) {
      return;
    }

    // n8n/Dify-style: load nested workflow metadata when the ref node is selected (no extra click).
    setGraphRefPreviewOpen(true);
    setGraphRefPreviewLoading(true);
    void loadGraphRefSnapshot(graphRefSelectionTargetId)
      .then((r) => {
        if (genAtStart !== graphRefPreviewGenRef.current) {
          return;
        }
        setGraphRefPreviewResult(r);
        setGraphRefPreviewLoading(false);
      })
      .catch(() => {
        if (genAtStart !== graphRefPreviewGenRef.current) {
          return;
        }
        setGraphRefPreviewResult({ ok: false, errorKind: "read" });
        setGraphRefPreviewLoading(false);
      });
  }, [
    graphRefInspectorKey,
    graphRefPreviewBlocked,
    graphRefSelectionTargetId,
    loadGraphRefSnapshot,
  ]);

  const runGraphRefPreviewLoad = useCallback(
    async (force: boolean) => {
      if (!loadGraphRefSnapshot || graphRefSelectionTargetId === "" || graphRefPreviewBlocked) {
        return;
      }
      const genAtStart = graphRefPreviewGenRef.current;
      setGraphRefPreviewLoading(true);
      try {
        const r = await loadGraphRefSnapshot(
          graphRefSelectionTargetId,
          force ? { force: true } : undefined,
        );
        if (genAtStart !== graphRefPreviewGenRef.current) {
          return;
        }
        setGraphRefPreviewResult(r);
      } finally {
        if (genAtStart === graphRefPreviewGenRef.current) {
          setGraphRefPreviewLoading(false);
        }
      }
    },
    [graphRefPreviewBlocked, graphRefSelectionTargetId, loadGraphRefSnapshot],
  );

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
    if (selection?.kind === "node" && selection.graphNodeType === GRAPH_NODE_TYPE_TASK) {
      const gca = isPlainObject(selection.raw.gcCursorAgent) ? selection.raw.gcCursorAgent : null;
      setCaEnabled(gca != null);
      if (gca != null) {
        setCaPrompt(typeof gca.prompt === "string" ? gca.prompt : "");
        setCaPromptFile(typeof gca.promptFile === "string" ? gca.promptFile : "");
        const cb = gca.cwdBase;
        setCaCwdBase(
          cb === "graphs_root" || cb === "artifact_dir" ? (cb as GcCursorAgentCwdBase) : "workspace_root",
        );
        setCaCwdRelative(typeof gca.cwdRelative === "string" ? gca.cwdRelative : "");
        setCaModel(typeof gca.model === "string" ? gca.model : "");
        setCaOutputFormat(typeof gca.outputFormat === "string" ? gca.outputFormat : "");
        setCaExtraArgsJson(Array.isArray(gca.extraArgs) ? JSON.stringify(gca.extraArgs) : "");
        setCaPrintMode(gca.printMode !== false);
        setCaApplyFileChanges(gca.applyFileChanges === true);
      } else {
        setCaPrompt("");
        setCaPromptFile("");
        setCaCwdBase("workspace_root");
        setCaCwdRelative("");
        setCaModel("");
        setCaOutputFormat("");
        setCaExtraArgsJson("");
        setCaPrintMode(true);
        setCaApplyFileChanges(false);
      }
    }
    if (selection?.kind === "node" && selection.graphNodeType === GRAPH_NODE_TYPE_MCP_TOOL) {
      const r = selection.raw;
      setMcpTransport(r.transport === "streamable_http" ? "streamable_http" : "stdio");
      setMcpToolName(typeof r.toolName === "string" ? r.toolName : "");
      const ts = r.timeoutSec;
      setMcpTimeoutSec(
        typeof ts === "number" && Number.isFinite(ts)
          ? String(ts)
          : typeof ts === "string" && ts.trim() !== ""
            ? ts.trim()
            : "60",
      );
      setMcpCommand(typeof r.command === "string" ? r.command : "");
      setMcpServerUrl(typeof r.serverUrl === "string" ? r.serverUrl : "");
      setMcpAllowInsecure(r.allowInsecureLocalhost === true);
      setMcpBearerKey(typeof r.bearerEnvKey === "string" ? r.bearerEnvKey : "");
      const ar = r.arguments;
      setMcpArgsJson(
        JSON.stringify(ar != null && typeof ar === "object" && !Array.isArray(ar) ? ar : {}, null, 2),
      );
    }
    if (selection?.kind === "node" && selection.graphNodeType === GRAPH_NODE_TYPE_LLM_AGENT) {
      const r = selection.raw;
      setLlmCommand(typeof r.command === "string" ? r.command : "");
      setLlmCwd(typeof r.cwd === "string" ? r.cwd : "");
      const lts = r.timeoutSec;
      setLlmTimeoutSec(
        typeof lts === "number" && Number.isFinite(lts)
          ? String(lts)
          : typeof lts === "string" && lts.trim() !== ""
            ? lts.trim()
            : "600",
      );
      const ms = r.maxAgentSteps;
      setLlmMaxSteps(
        typeof ms === "number" && Number.isFinite(ms)
          ? String(Math.max(0, Math.floor(ms)))
          : typeof ms === "string" && ms.trim() !== ""
            ? ms.trim()
            : "0",
      );
      const ek = r.envKeys;
      if (Array.isArray(ek)) {
        setLlmEnvKeysCsv(ek.filter((x) => typeof x === "string").join(", "));
      } else {
        setLlmEnvKeysCsv("");
      }
      const ip = r.inputPayload;
      try {
        setLlmInputPayloadJson(JSON.stringify(ip ?? {}, null, 2));
      } catch {
        setLlmInputPayloadJson("{}");
      }
    }
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
    let nextData: Record<string, unknown> = { ...parsed };
    if (selection.graphNodeType === GRAPH_NODE_TYPE_TASK) {
      if (caEnabled) {
        const vKey = cursorAgentUiValidationKey({ prompt: caPrompt, promptFile: caPromptFile });
        if (vKey != null) {
          showInspectorError(presentationForInspectorSimple(t, vKey), vKey);
          return;
        }
        try {
          parseExtraArgsJson(caExtraArgsJson);
        } catch {
          showInspectorError(
            presentationForInspectorSimple(t, "app.inspector.cursorAgentExtraArgsInvalid"),
            "app.inspector.cursorAgentExtraArgsInvalid",
          );
          return;
        }
        nextData = {
          ...nextData,
          gcCursorAgent: buildGcCursorAgentPayload({
            prompt: caPrompt,
            promptFile: caPromptFile,
            cwdBase: caCwdBase,
            cwdRelative: caCwdRelative,
            model: caModel,
            outputFormat: caOutputFormat,
            extraArgsJson: caExtraArgsJson,
            printMode: caPrintMode,
            applyFileChanges: caApplyFileChanges,
          }),
        };
      } else {
        const { gcCursorAgent: _rm, ...rest } = nextData;
        nextData = { ...rest };
      }
    }
    onApplyNodeData(selection.id, nextData);
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

  const applyMcpFields = () => {
    if (runLocked || selection?.kind !== "node" || selection.graphNodeType !== GRAPH_NODE_TYPE_MCP_TOOL) {
      return;
    }
    let argsObj: Record<string, unknown>;
    try {
      const p = JSON.parse(mcpArgsJson);
      if (!isPlainObject(p)) {
        throw new Error("not_object");
      }
      argsObj = p;
    } catch {
      showInspectorError(
        presentationForInspectorSimple(t, "app.inspector.mcpArgumentsInvalid"),
        "app.inspector.mcpArgumentsInvalid",
      );
      return;
    }
    const toN = Number.parseFloat(mcpTimeoutSec);
    const timeoutSec = Number.isFinite(toN) ? Math.min(600, Math.max(1, toN)) : 60;
    const base = isPlainObject(selection.raw) ? { ...selection.raw } : {};
    const cmdTrim = mcpCommand.trim();
    const next: Record<string, unknown> = {
      ...base,
      transport: mcpTransport,
      toolName: mcpToolName.trim(),
      timeoutSec,
      arguments: argsObj,
      allowInsecureLocalhost: mcpAllowInsecure,
    };
    if (cmdTrim !== "") {
      next.command = mcpCommand;
    } else {
      delete next.command;
    }
    const urlTrim = mcpServerUrl.trim();
    if (urlTrim !== "") {
      next.serverUrl = mcpServerUrl;
    } else {
      delete next.serverUrl;
    }
    const beTrim = mcpBearerKey.trim();
    if (beTrim !== "") {
      next.bearerEnvKey = beTrim;
    } else {
      delete next.bearerEnvKey;
    }
    onApplyNodeData(selection.id, next);
  };

  const applyLlmAgentFields = () => {
    if (runLocked || selection?.kind !== "node" || selection.graphNodeType !== GRAPH_NODE_TYPE_LLM_AGENT) {
      return;
    }
    let payloadObj: Record<string, unknown>;
    try {
      const p = JSON.parse(llmInputPayloadJson);
      if (!isPlainObject(p)) {
        throw new Error("not_object");
      }
      payloadObj = p;
    } catch {
      showInspectorError(
        presentationForInspectorSimple(t, "app.inspector.llmAgentInputPayloadInvalid"),
        "app.inspector.llmAgentInputPayloadInvalid",
      );
      return;
    }
    const toN = Number.parseFloat(llmTimeoutSec);
    const timeoutSec = Number.isFinite(toN) ? Math.min(86400, Math.max(1, toN)) : 600;
    const msRaw = Number.parseInt(llmMaxSteps.trim(), 10);
    const maxAgentSteps = Number.isFinite(msRaw) ? Math.max(0, msRaw) : 0;
    const keys = llmEnvKeysCsv
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const base = isPlainObject(selection.raw) ? { ...selection.raw } : {};
    const next: Record<string, unknown> = {
      ...base,
      title:
        typeof base.title === "string" && base.title.trim() !== "" ? base.title : "LLM agent",
      timeoutSec,
      maxAgentSteps,
      inputPayload: payloadObj,
    };
    const cmdTrim = llmCommand.trim();
    if (cmdTrim !== "") {
      next.command = llmCommand;
    } else {
      delete next.command;
    }
    const cwdTrim = llmCwd.trim();
    if (cwdTrim !== "") {
      next.cwd = llmCwd;
    } else {
      delete next.cwd;
    }
    if (keys.length > 0) {
      next.envKeys = keys;
    } else {
      delete next.envKeys;
    }
    onApplyNodeData(selection.id, next);
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
          {selection.graphNodeType === GRAPH_NODE_TYPE_MCP_TOOL ? (
            <div className="gc-inspector-mcp">
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-mcp-transport">
                  {t("app.inspector.mcpTransport")}
                </label>
                <select
                  id="gc-inspector-mcp-transport"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  value={mcpTransport}
                  onChange={(ev) => {
                    const v = ev.target.value === "streamable_http" ? "streamable_http" : "stdio";
                    setMcpTransport(v);
                  }}
                >
                  <option value="stdio">{t("app.inspector.mcpTransportStdio")}</option>
                  <option value="streamable_http">{t("app.inspector.mcpTransportHttp")}</option>
                </select>
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-mcp-tool">
                  {t("app.inspector.mcpToolName")}
                </label>
                <input
                  id="gc-inspector-mcp-tool"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  value={mcpToolName}
                  onChange={(ev) => {
                    setMcpToolName(ev.target.value);
                  }}
                />
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-mcp-timeout">
                  {t("app.inspector.mcpTimeoutSec")}
                </label>
                <input
                  id="gc-inspector-mcp-timeout"
                  type="text"
                  inputMode="decimal"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  value={mcpTimeoutSec}
                  onChange={(ev) => {
                    setMcpTimeoutSec(ev.target.value);
                  }}
                />
              </div>
              {mcpTransport === "stdio" ? (
                <div className="gc-inspector-row gc-inspector-row--field">
                  <label className="gc-inspector-k" htmlFor="gc-inspector-mcp-cmd">
                    {t("app.inspector.mcpCommand")}
                  </label>
                  <input
                    id="gc-inspector-mcp-cmd"
                    className="gc-inspector-condition-input"
                    disabled={runLocked}
                    value={mcpCommand}
                    onChange={(ev) => {
                      setMcpCommand(ev.target.value);
                    }}
                  />
                  <p className="gc-inspector-edge-hint">{t("app.inspector.mcpCommandHint")}</p>
                </div>
              ) : (
                <>
                  <div className="gc-inspector-row gc-inspector-row--field">
                    <label className="gc-inspector-k" htmlFor="gc-inspector-mcp-url">
                      {t("app.inspector.mcpServerUrl")}
                    </label>
                    <input
                      id="gc-inspector-mcp-url"
                      className="gc-inspector-condition-input"
                      disabled={runLocked}
                      value={mcpServerUrl}
                      onChange={(ev) => {
                        setMcpServerUrl(ev.target.value);
                      }}
                    />
                    <p className="gc-inspector-edge-hint">{t("app.inspector.mcpServerUrlHint")}</p>
                  </div>
                  <div className="gc-inspector-row gc-inspector-row--field">
                    <label className="gc-inspector-k" htmlFor="gc-inspector-mcp-bearer">
                      {t("app.inspector.mcpBearerEnvKey")}
                    </label>
                    <input
                      id="gc-inspector-mcp-bearer"
                      className="gc-inspector-condition-input"
                      disabled={runLocked}
                      value={mcpBearerKey}
                      onChange={(ev) => {
                        setMcpBearerKey(ev.target.value);
                      }}
                    />
                    <p className="gc-inspector-edge-hint">{t("app.inspector.mcpBearerEnvKeyHint")}</p>
                  </div>
                  <div className="gc-inspector-row gc-inspector-row--field">
                    <label className="gc-inspector-k" htmlFor="gc-inspector-mcp-insecure">
                      {t("app.inspector.mcpAllowInsecureLocalhost")}
                    </label>
                    <input
                      id="gc-inspector-mcp-insecure"
                      type="checkbox"
                      disabled={runLocked}
                      checked={mcpAllowInsecure}
                      onChange={(ev) => {
                        setMcpAllowInsecure(ev.target.checked);
                      }}
                    />
                  </div>
                </>
              )}
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-mcp-args">
                  {t("app.inspector.mcpArgumentsJson")}
                </label>
                <textarea
                  id="gc-inspector-mcp-args"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  rows={5}
                  value={mcpArgsJson}
                  onChange={(ev) => {
                    setMcpArgsJson(ev.target.value);
                  }}
                />
              </div>
              <button
                type="button"
                className="gc-btn gc-inspector-apply"
                disabled={runLocked}
                onClick={applyMcpFields}
              >
                {t("app.inspector.applyMcpSettings")}
              </button>
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
            </div>
          ) : null}
          {selection.graphNodeType === GRAPH_NODE_TYPE_LLM_AGENT ? (
            <div className="gc-inspector-mcp">
              <div className="gc-inspector-pin">
                <div className="gc-inspector-row gc-inspector-row--field">
                  <span className="gc-inspector-k">{t("app.inspector.stepCacheHeading")}</span>
                  <label className="gc-inspector-pin-toggle">
                    <input
                      type="checkbox"
                      disabled={runLocked}
                      checked={isPlainObject(selection.raw) && selection.raw.stepCache === true}
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
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-llm-cmd">
                  {t("app.inspector.llmAgentCommand")}
                </label>
                <input
                  id="gc-inspector-llm-cmd"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  spellCheck={false}
                  value={llmCommand}
                  onChange={(ev) => {
                    setLlmCommand(ev.target.value);
                  }}
                />
                <p className="gc-inspector-edge-hint">{t("app.inspector.llmAgentCommandHint")}</p>
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-llm-cwd">
                  {t("app.inspector.llmAgentCwd")}
                </label>
                <input
                  id="gc-inspector-llm-cwd"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  value={llmCwd}
                  onChange={(ev) => {
                    setLlmCwd(ev.target.value);
                  }}
                />
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-llm-timeout">
                  {t("app.inspector.llmAgentTimeoutSec")}
                </label>
                <input
                  id="gc-inspector-llm-timeout"
                  type="text"
                  inputMode="decimal"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  value={llmTimeoutSec}
                  onChange={(ev) => {
                    setLlmTimeoutSec(ev.target.value);
                  }}
                />
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-llm-maxsteps">
                  {t("app.inspector.llmAgentMaxSteps")}
                </label>
                <input
                  id="gc-inspector-llm-maxsteps"
                  type="text"
                  inputMode="numeric"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  value={llmMaxSteps}
                  onChange={(ev) => {
                    setLlmMaxSteps(ev.target.value);
                  }}
                />
                <p className="gc-inspector-edge-hint">{t("app.inspector.llmAgentMaxStepsHint")}</p>
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-llm-envkeys">
                  {t("app.inspector.llmAgentEnvKeys")}
                </label>
                <input
                  id="gc-inspector-llm-envkeys"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  spellCheck={false}
                  value={llmEnvKeysCsv}
                  onChange={(ev) => {
                    setLlmEnvKeysCsv(ev.target.value);
                  }}
                />
                <p className="gc-inspector-edge-hint">{t("app.inspector.llmAgentEnvKeysHint")}</p>
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-llm-payload">
                  {t("app.inspector.llmAgentInputPayload")}
                </label>
                <textarea
                  id="gc-inspector-llm-payload"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  rows={4}
                  spellCheck={false}
                  value={llmInputPayloadJson}
                  onChange={(ev) => {
                    setLlmInputPayloadJson(ev.target.value);
                  }}
                />
              </div>
              <button
                type="button"
                className="gc-btn gc-inspector-apply"
                disabled={runLocked}
                onClick={applyLlmAgentFields}
              >
                {t("app.inspector.applyLlmAgentSettings")}
              </button>
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
          {selection.graphNodeType === GRAPH_NODE_TYPE_AI_ROUTE ? (
            <div className="gc-inspector-pin">
              <div className="gc-inspector-row gc-inspector-row--field">
                <span className="gc-inspector-k">{t("app.inspector.stepCacheHeading")}</span>
                <label className="gc-inspector-pin-toggle">
                  <input
                    type="checkbox"
                    disabled={runLocked}
                    checked={isPlainObject(selection.raw) && selection.raw.stepCache === true}
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
            <div className="gc-inspector-pin">
              <div className="gc-inspector-row gc-inspector-row--field">
                <span className="gc-inspector-k">{t("app.inspector.cursorAgentHeading")}</span>
                <label className="gc-inspector-pin-toggle">
                  <input
                    type="checkbox"
                    disabled={runLocked}
                    checked={caEnabled}
                    onChange={(ev) => {
                      setCaEnabled(ev.target.checked);
                    }}
                  />
                  <span>{t("app.inspector.cursorAgentEnabled")}</span>
                </label>
              </div>
              {caEnabled ? (
                <>
                  <label className="gc-inspector-data-label" htmlFor="gc-ca-prompt">
                    {t("app.inspector.cursorAgentPrompt")}
                  </label>
                  <textarea
                    id="gc-ca-prompt"
                    className="gc-inspector-data-textarea"
                    rows={4}
                    disabled={runLocked}
                    spellCheck
                    autoComplete="off"
                    value={caPrompt}
                    onChange={(ev) => {
                      setCaPrompt(ev.target.value);
                    }}
                  />
                  <label className="gc-inspector-data-label" htmlFor="gc-ca-prompt-file">
                    {t("app.inspector.cursorAgentPromptFile")}
                  </label>
                  <input
                    id="gc-ca-prompt-file"
                    className="gc-inspector-condition-input"
                    type="text"
                    disabled={runLocked}
                    spellCheck={false}
                    autoComplete="off"
                    value={caPromptFile}
                    onChange={(ev) => {
                      setCaPromptFile(ev.target.value);
                    }}
                  />
                  <label className="gc-inspector-data-label" htmlFor="gc-ca-cwd-base">
                    {t("app.inspector.cursorAgentCwdBase")}
                  </label>
                  <select
                    id="gc-ca-cwd-base"
                    className="gc-inspector-condition-input"
                    disabled={runLocked}
                    value={caCwdBase}
                    onChange={(ev) => {
                      const v = ev.target.value;
                      setCaCwdBase(
                        v === "graphs_root" || v === "artifact_dir" ? v : "workspace_root",
                      );
                    }}
                  >
                    <option value="workspace_root">{t("app.inspector.cursorAgentCwdWorkspace")}</option>
                    <option value="graphs_root">{t("app.inspector.cursorAgentCwdGraphs")}</option>
                    <option value="artifact_dir">{t("app.inspector.cursorAgentCwdArtifact")}</option>
                  </select>
                  <label className="gc-inspector-data-label" htmlFor="gc-ca-cwd-rel">
                    {t("app.inspector.cursorAgentCwdRelative")}
                  </label>
                  <input
                    id="gc-ca-cwd-rel"
                    className="gc-inspector-condition-input"
                    type="text"
                    disabled={runLocked}
                    spellCheck={false}
                    autoComplete="off"
                    value={caCwdRelative}
                    onChange={(ev) => {
                      setCaCwdRelative(ev.target.value);
                    }}
                  />
                  <label className="gc-inspector-data-label" htmlFor="gc-ca-model">
                    {t("app.inspector.cursorAgentModel")}
                  </label>
                  <input
                    id="gc-ca-model"
                    className="gc-inspector-condition-input"
                    type="text"
                    disabled={runLocked}
                    spellCheck={false}
                    autoComplete="off"
                    value={caModel}
                    onChange={(ev) => {
                      setCaModel(ev.target.value);
                    }}
                  />
                  <label className="gc-inspector-data-label" htmlFor="gc-ca-out-fmt">
                    {t("app.inspector.cursorAgentOutputFormat")}
                  </label>
                  <input
                    id="gc-ca-out-fmt"
                    className="gc-inspector-condition-input"
                    type="text"
                    disabled={runLocked}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="text"
                    value={caOutputFormat}
                    onChange={(ev) => {
                      setCaOutputFormat(ev.target.value);
                    }}
                  />
                  <label className="gc-inspector-data-label" htmlFor="gc-ca-extra">
                    {t("app.inspector.cursorAgentExtraArgs")}
                  </label>
                  <textarea
                    id="gc-ca-extra"
                    className="gc-inspector-data-textarea"
                    rows={2}
                    disabled={runLocked}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder='["--stream-partial-output"]'
                    value={caExtraArgsJson}
                    onChange={(ev) => {
                      setCaExtraArgsJson(ev.target.value);
                    }}
                  />
                  <div className="gc-inspector-row gc-inspector-row--field">
                    <label className="gc-inspector-pin-toggle">
                      <input
                        type="checkbox"
                        disabled={runLocked}
                        checked={caPrintMode}
                        onChange={(ev) => {
                          setCaPrintMode(ev.target.checked);
                        }}
                      />
                      <span>{t("app.inspector.cursorAgentPrintMode")}</span>
                    </label>
                  </div>
                  <div className="gc-inspector-row gc-inspector-row--field">
                    <label className="gc-inspector-pin-toggle">
                      <input
                        type="checkbox"
                        disabled={runLocked}
                        checked={caApplyFileChanges}
                        onChange={(ev) => {
                          setCaApplyFileChanges(ev.target.checked);
                        }}
                      />
                      <span>{t("app.inspector.cursorAgentApplyFiles")}</span>
                    </label>
                  </div>
                  <p className="gc-inspector-edge-hint">{t("app.inspector.cursorAgentHint")}</p>
                </>
              ) : null}
            </div>
            </>
          ) : null}
          {isGraphDocumentFrameType(selection.graphNodeType) ? (
            <p className="gc-inspector-edge-hint">
              {selection.graphNodeType === GRAPH_NODE_TYPE_GROUP
                ? t("app.inspector.groupFrameHint")
                : t("app.inspector.commentFrameHint")}
            </p>
          ) : null}
          {selection.graphNodeType === "graph_ref" ? (
            <div className="gc-inspector-graphref">
              <div className="gc-inspector-graphref-preview">
                <div className="gc-inspector-row gc-inspector-row--field">
                  <span className="gc-inspector-k">{t("app.inspector.graphRefPreviewHeading")}</span>
                </div>
                <p className="gc-inspector-edge-hint">{t("app.inspector.graphRefPreviewHint")}</p>
                {graphRefWorkspaceHintState.kind === "missing" ? (
                  <p className="gc-inspector-edge-hint" role="alert">
                    {t("app.inspector.graphRefPreviewErrorUnknown")}
                  </p>
                ) : null}
                <div className="gc-inspector-row gc-inspector-row--field gc-inspector-row--buttons">
                  <button
                    type="button"
                    className="gc-btn gc-inspector-apply"
                    aria-expanded={graphRefPreviewOpen}
                    aria-controls={`gc-graphref-preview-${selection.id}`}
                    disabled={
                      !workspaceLinked ||
                      graphRefSelectionTargetId === "" ||
                      loadGraphRefSnapshot == null ||
                      graphRefPreviewBlocked
                    }
                    onClick={() => {
                      const next = !graphRefPreviewOpen;
                      setGraphRefPreviewOpen(next);
                      if (next) {
                        void runGraphRefPreviewLoad(false);
                      }
                    }}
                  >
                    {graphRefPreviewOpen
                      ? t("app.inspector.graphRefPreviewCollapse")
                      : t("app.inspector.graphRefPreviewExpand")}
                  </button>
                  <button
                    type="button"
                    className="gc-btn gc-inspector-apply"
                    disabled={
                      !graphRefPreviewOpen ||
                      graphRefPreviewLoading ||
                      !workspaceLinked ||
                      graphRefSelectionTargetId === "" ||
                      loadGraphRefSnapshot == null ||
                      graphRefPreviewBlocked
                    }
                    onClick={() => {
                      void runGraphRefPreviewLoad(true);
                    }}
                  >
                    {t("app.inspector.graphRefPreviewRefresh")}
                  </button>
                </div>
                {graphRefPreviewOpen ? (
                  <div
                    id={`gc-graphref-preview-${selection.id}`}
                    className="gc-inspector-graphref-preview-panel"
                    role="region"
                    aria-label={t("app.inspector.graphRefPreviewHeading")}
                  >
                    {graphRefPreviewLoading ? (
                      <p className="gc-inspector-edge-hint">{t("app.inspector.graphRefPreviewLoading")}</p>
                    ) : null}
                    {graphRefWorkspaceHintState.kind === "ok" ? (
                      <>
                        <p className="gc-inspector-edge-hint">
                          {t("app.inspector.graphRefPreviewIndexFile", {
                            file: graphRefWorkspaceHintState.hint.fileName,
                          })}
                        </p>
                        {graphRefWorkspaceHintState.hint.title ? (
                          <p className="gc-inspector-edge-hint">
                            {t("app.inspector.graphRefPreviewIndexTitle", {
                              title: graphRefWorkspaceHintState.hint.title,
                            })}
                          </p>
                        ) : null}
                        {graphRefWorkspaceHintState.hint.duplicateGraphId ? (
                          <p className="gc-inspector-edge-hint" role="status">
                            {t("app.inspector.graphRefPreviewDuplicateId")}
                          </p>
                        ) : null}
                      </>
                    ) : null}
                    {!graphRefPreviewLoading && graphRefPreviewResult != null && !graphRefPreviewResult.ok ? (
                      <p className="gc-inspector-edge-hint" role="alert">
                        {graphRefPreviewResult.errorKind === "json"
                          ? t("app.inspector.graphRefPreviewErrorJson")
                          : graphRefPreviewResult.errorKind === "parse_doc"
                            ? t("app.inspector.graphRefPreviewErrorParseDoc")
                            : graphRefPreviewResult.errorKind === "read"
                              ? t("app.inspector.graphRefPreviewErrorRead")
                              : graphRefPreviewResult.errorKind === "no_workspace"
                                ? t("app.inspector.graphRefPreviewErrorNoWorkspace")
                                : t("app.inspector.graphRefPreviewErrorUnknown")}
                      </p>
                    ) : null}
                    {!graphRefPreviewLoading &&
                    graphRefPreviewResult != null &&
                    graphRefPreviewResult.ok ? (
                      <ul className="gc-inspector-graphref-preview-list">
                        <li>
                          {t("app.inspector.graphRefPreviewNodes", {
                            count: graphRefPreviewResult.snapshot.workflowNodeCount,
                          })}
                        </li>
                        {graphRefPreviewResult.snapshot.schemaVersion != null ? (
                          <li>
                            {t("app.inspector.graphRefPreviewSchema", {
                              v: graphRefPreviewResult.snapshot.schemaVersion,
                            })}
                          </li>
                        ) : null}
                        {graphRefPreviewResult.snapshot.title ? (
                          <li>
                            {t("app.inspector.graphRefPreviewDocTitle", {
                              title: graphRefPreviewResult.snapshot.title,
                            })}
                          </li>
                        ) : null}
                        {graphRefPreviewResult.snapshot.graphId ? (
                          <li>
                            {t("app.inspector.graphRefPreviewFileGraphId", {
                              id: graphRefPreviewResult.snapshot.graphId,
                            })}
                          </li>
                        ) : null}
                        {!graphRefPreviewResult.snapshot.hasStart ? (
                          <li className="gc-inspector-edge-hint" role="status">
                            {t("app.inspector.graphRefPreviewNoStart")}
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
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
