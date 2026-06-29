// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import type { GraphCanvasSelection } from "../canvas/graphCanvasSelection";
import type { GraphDocumentJson } from "../../graph/types";
import {
  GRAPH_NODE_TYPE_AI_ROUTE,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_HTTP_REQUEST,
  GRAPH_NODE_TYPE_RAG_QUERY,
  GRAPH_NODE_TYPE_RAG_INDEX,
  GRAPH_NODE_TYPE_DELAY,
  GRAPH_NODE_TYPE_DEBOUNCE,
  GRAPH_NODE_TYPE_WAIT_FOR,
  GRAPH_NODE_TYPE_SET_VARIABLE,
  GRAPH_NODE_TYPE_LLM_AGENT,
  GRAPH_NODE_TYPE_AGENT,
  GRAPH_NODE_TYPE_GROUP,
  GRAPH_NODE_TYPE_TASK,
  GRAPH_NODE_TYPE_TRIGGER_WEBHOOK,
  GRAPH_NODE_TYPE_TRIGGER_SCHEDULE,
  isGraphDocumentFrameType,
} from "../../graph/nodeKinds";
import { useRunSessionOutputs } from "../../run/runSessionStore";
import { mergeModeFromNodeData, parseWaitForFileParamsFromData } from "../../graph/structureWarnings";
import {
  type AppMessagePresentation,
  presentationForInspectorJsonSyntaxError,
  presentationForInspectorSimple,
} from "../../graph/openGraphErrorPresentation";
import { safeExternalHttpUrl } from "../../lib/safeExternalUrl";
import { INSPECTOR_REGISTRY } from "../../graph/inspectorRegistry";
import type { GraphRefSnapshotLoadResult } from "../../graph/graphRefLazySnapshot";
import {
  GCPIN_PAYLOAD_WARN_BYTES,
  agentPromptFromNodeRaw,
  estimateJsonUtf8Bytes,
  graphRefTargetId,
  isPlainObject,
  logGraphRefPreviewUnexpected,
  payloadForGcPin,
} from "../../graph/inspectorValidation";
import { StepCacheInspector } from "./StepCacheInspector";

type NodeSelection = Extract<GraphCanvasSelection, { kind: "node" }>;

export type NodeInspectorProps = {
  selection: NodeSelection;
  graphDocument: GraphDocumentJson;
  expressionNodeIds: readonly string[];
  expressionEditorMonaco: boolean;
  setExpressionEditorMonaco: (value: boolean) => void;
  runLocked: boolean;
  workspaceLinked: boolean;
  onApplyNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  onUserMessage?: (presentation: AppMessagePresentation) => void;
  onOpenNestedGraph?: (targetGraphId: string, graphRefNodeId?: string) => void;
  loadGraphRefSnapshot?: (
    targetGraphId: string,
    options?: { force?: boolean },
  ) => Promise<GraphRefSnapshotLoadResult>;
  getGraphRefWorkspaceHint?: (
    targetGraphId: string,
  ) => { title?: string; fileName: string; duplicateGraphId: boolean } | null;
  getDocumentForStepCacheDirty?: () => GraphDocumentJson;
  onMarkStepCacheDirtyTransitive?: (doc: GraphDocumentJson, seeds: readonly string[]) => void;
  onRunUntilThisNode?: () => void;
  runUntilThisNodeEnabled: boolean;
};

export function NodeInspector({
  selection,
  graphDocument,
  expressionNodeIds: _expressionNodeIds,
  expressionEditorMonaco,
  setExpressionEditorMonaco,
  runLocked,
  workspaceLinked,
  onApplyNodeData,
  onUserMessage,
  onOpenNestedGraph,
  loadGraphRefSnapshot,
  getGraphRefWorkspaceHint,
  getDocumentForStepCacheDirty,
  onMarkStepCacheDirtyTransitive,
  onRunUntilThisNode,
  runUntilThisNodeEnabled,
}: NodeInspectorProps) {
  const { t } = useTranslation();
  const nodeOutputSnapshots = useRunSessionOutputs();

  const [dataText, setDataText] = useState("{}");

  const [ragIndexCollectionId, setRagIndexCollectionId] = useState("");
  const [ragIndexText, setRagIndexText] = useState("");
  const [ragIndexMode, setRagIndexMode] = useState<"replace" | "append">("replace");
  const [ragIndexChunkSize, setRagIndexChunkSize] = useState("512");
  const [ragIndexChunkOverlap, setRagIndexChunkOverlap] = useState("64");
  const [ragIndexEmbeddingDims, setRagIndexEmbeddingDims] = useState("64");

  const [sleepDurationSec, setSleepDurationSec] = useState("1");
  const [waitForMode, setWaitForMode] = useState("file");
  const [waitForPath, setWaitForPath] = useState("");
  const [waitForTimeoutSec, setWaitForTimeoutSec] = useState("300");
  const [waitForPollSec, setWaitForPollSec] = useState("0.25");

  const [setVarName, setSetVarName] = useState("");
  const [setVarOperation, setSetVarOperation] = useState<"set" | "increment" | "append" | "delete">(
    "set",
  );
  const [setVarValueJson, setSetVarValueJson] = useState("null");

  const [llmCommand, setLlmCommand] = useState("");
  const [llmCwd, setLlmCwd] = useState("");
  const [llmTimeoutSec, setLlmTimeoutSec] = useState("600");
  const [llmMaxSteps, setLlmMaxSteps] = useState("0");
  const [llmEnvKeysCsv, setLlmEnvKeysCsv] = useState("");
  const [llmInputPayloadJson, setLlmInputPayloadJson] = useState("{}");

  const [agentInputText, setAgentInputText] = useState("");
  const [agentSystemPrompt, setAgentSystemPrompt] = useState("");
  const [agentMaxIter, setAgentMaxIter] = useState("10");

  const [graphRefPreviewOpen, setGraphRefPreviewOpen] = useState(false);
  const [graphRefPreviewLoading, setGraphRefPreviewLoading] = useState(false);
  const [graphRefPreviewResult, setGraphRefPreviewResult] = useState<GraphRefSnapshotLoadResult | null>(
    null,
  );
  const graphRefPreviewGenRef = useRef(0);

  const graphRefInspectorKey = useMemo(() => {
    if (selection.graphNodeType !== "graph_ref") {
      return "";
    }
    return `${selection.id}\0${graphRefTargetId(selection.raw)}`;
  }, [selection]);

  const graphRefSelectionTargetId = useMemo(() => {
    if (selection.graphNodeType !== "graph_ref") {
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

    if (
      graphRefInspectorKey === "" ||
      graphRefPreviewBlocked ||
      loadGraphRefSnapshot == null ||
      graphRefSelectionTargetId === ""
    ) {
      setGraphRefPreviewOpen(false);
      setGraphRefPreviewLoading(false);
      setGraphRefPreviewResult(null);
      return;
    }

    setGraphRefPreviewOpen(true);
    setGraphRefPreviewLoading(true);
    setGraphRefPreviewResult(null);
    void loadGraphRefSnapshot(graphRefSelectionTargetId)
      .then((r) => {
        if (genAtStart !== graphRefPreviewGenRef.current) {
          return;
        }
        setGraphRefPreviewResult(r);
        setGraphRefPreviewLoading(false);
      })
      .catch((err: unknown) => {
        logGraphRefPreviewUnexpected(err);
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
      } catch (err: unknown) {
        logGraphRefPreviewUnexpected(err);
        if (genAtStart === graphRefPreviewGenRef.current) {
          setGraphRefPreviewResult({ ok: false, errorKind: "read" });
        }
      } finally {
        if (genAtStart === graphRefPreviewGenRef.current) {
          setGraphRefPreviewLoading(false);
        }
      }
    },
    [graphRefPreviewBlocked, graphRefSelectionTargetId, loadGraphRefSnapshot],
  );

  useEffect(() => {
    if (selection.graphNodeType === GRAPH_NODE_TYPE_RAG_INDEX) {
      const r = selection.raw;
      const cid =
        typeof r.collectionId === "string"
          ? r.collectionId
          : typeof r.collection_id === "string"
            ? r.collection_id
            : "";
      setRagIndexCollectionId(cid);
      setRagIndexText(typeof r.text === "string" ? r.text : "");
      const mo = String(r.mode ?? "replace").trim().toLowerCase();
      setRagIndexMode(mo === "append" ? "append" : "replace");
      const cs = r.chunkSize;
      setRagIndexChunkSize(
        typeof cs === "number" && Number.isFinite(cs)
          ? String(Math.trunc(cs))
          : typeof cs === "string" && cs.trim() !== ""
            ? cs.trim()
            : "512",
      );
      const co = r.chunkOverlap;
      setRagIndexChunkOverlap(
        typeof co === "number" && Number.isFinite(co)
          ? String(Math.trunc(co))
          : typeof co === "string" && co.trim() !== ""
            ? co.trim()
            : "64",
      );
      const ed = r.embeddingDims;
      setRagIndexEmbeddingDims(
        typeof ed === "number" && Number.isFinite(ed)
          ? String(Math.trunc(ed))
          : typeof ed === "string" && ed.trim() !== ""
            ? ed.trim()
            : "64",
      );
    }
    if (
      selection.graphNodeType === GRAPH_NODE_TYPE_DELAY ||
      selection.graphNodeType === GRAPH_NODE_TYPE_DEBOUNCE
    ) {
      const r = selection.raw;
      const ds = r.durationSec;
      setSleepDurationSec(
        typeof ds === "number" && Number.isFinite(ds)
          ? String(ds)
          : typeof ds === "string" && ds.trim() !== ""
            ? ds.trim()
            : "1",
      );
    }
    if (selection.graphNodeType === GRAPH_NODE_TYPE_WAIT_FOR) {
      const r = selection.raw;
      const wm = r.waitMode;
      setWaitForMode(
        typeof wm === "string" && wm.trim() !== "" ? wm.trim().toLowerCase() : "file",
      );
      setWaitForPath(typeof r.path === "string" ? r.path : "");
      const ts = r.timeoutSec;
      setWaitForTimeoutSec(
        typeof ts === "number" && Number.isFinite(ts)
          ? String(ts)
          : typeof ts === "string" && ts.trim() !== ""
            ? ts.trim()
            : "300",
      );
      const pi = r.pollIntervalSec;
      setWaitForPollSec(
        typeof pi === "number" && Number.isFinite(pi)
          ? String(pi)
          : typeof pi === "string" && pi.trim() !== ""
            ? pi.trim()
            : "0.25",
      );
    }
    if (selection.graphNodeType === GRAPH_NODE_TYPE_SET_VARIABLE) {
      const r = selection.raw;
      const n = (r as Record<string, unknown>).name ?? (r as Record<string, unknown>).variableName;
      setSetVarName(typeof n === "string" ? n : "");
      const op = String((r as Record<string, unknown>).operation ?? "set")
        .trim()
        .toLowerCase();
      setSetVarOperation(
        op === "increment" || op === "append" || op === "delete" ? op : "set",
      );
      try {
        setSetVarValueJson(JSON.stringify((r as Record<string, unknown>).value ?? null, null, 2));
      } catch {
        setSetVarValueJson("null");
      }
    }
    if (selection.graphNodeType === GRAPH_NODE_TYPE_LLM_AGENT) {
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
    if (selection.graphNodeType === GRAPH_NODE_TYPE_AGENT) {
      const r = selection.raw;
      const rawObj = isPlainObject(r) ? r : {};
      setAgentInputText(agentPromptFromNodeRaw(rawObj));
      setAgentSystemPrompt(typeof rawObj.systemPrompt === "string" ? rawObj.systemPrompt : "");
      const mi = rawObj.maxIterations ?? rawObj.max_iterations;
      if (typeof mi === "number" && Number.isFinite(mi)) {
        setAgentMaxIter(String(Math.max(1, Math.min(50, Math.floor(mi)))));
      } else if (typeof mi === "string" && mi.trim() !== "") {
        setAgentMaxIter(mi.trim());
      } else {
        setAgentMaxIter("10");
      }
    }
    setDataText(JSON.stringify(selection.raw, null, 2));
  }, [selection]);

  const aiRouteEndpointHref = useMemo(() => {
    if (selection.graphNodeType !== GRAPH_NODE_TYPE_AI_ROUTE) {
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

  const httpRequestEndpointHref = useMemo(() => {
    if (
      selection.graphNodeType !== GRAPH_NODE_TYPE_HTTP_REQUEST &&
      selection.graphNodeType !== GRAPH_NODE_TYPE_RAG_QUERY
    ) {
      return null;
    }
    if (selection.graphNodeType === GRAPH_NODE_TYPE_RAG_QUERY && isPlainObject(selection.raw)) {
      const r = selection.raw;
      if (String(r.vectorBackend ?? "").trim().toLowerCase() === "memory") {
        return null;
      }
    }
    try {
      const parsed: unknown = JSON.parse(dataText);
      if (isPlainObject(parsed) && Object.prototype.hasOwnProperty.call(parsed, "url")) {
        return safeExternalHttpUrl(parsed.url);
      }
    } catch {
      /* keep saved document as fallback below */
    }
    const raw = selection.raw;
    return isPlainObject(raw) ? safeExternalHttpUrl(raw.url) : null;
  }, [dataText, selection]);

  const showInspectorError = (presentation: AppMessagePresentation, legacyAlertKey: string) => {
    if (onUserMessage) {
      onUserMessage(presentation);
    } else {
      window.alert(t(legacyAlertKey));
    }
  };

  const onSubmitNode = (e: FormEvent) => {
    e.preventDefault();
    if (runLocked) {
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

  const applyRagIndexFields = () => {
    if (runLocked || selection.graphNodeType !== GRAPH_NODE_TYPE_RAG_INDEX) {
      return;
    }
    const cs = Number.parseInt(ragIndexChunkSize, 10);
    const chunkSize = Number.isFinite(cs) ? Math.min(8192, Math.max(32, cs)) : 512;
    const co = Number.parseInt(ragIndexChunkOverlap, 10);
    const chunkOverlap = Number.isFinite(co) ? Math.min(chunkSize - 1, Math.max(0, co)) : 64;
    const ed = Number.parseInt(ragIndexEmbeddingDims, 10);
    const embeddingDims = Number.isFinite(ed) ? Math.min(1024, Math.max(8, ed)) : 64;
    const base = isPlainObject(selection.raw) ? { ...selection.raw } : {};
    onApplyNodeData(selection.id, {
      ...base,
      title:
        typeof base.title === "string" && base.title.trim() !== "" ? base.title : "RAG index",
      collectionId: ragIndexCollectionId,
      text: ragIndexText,
      mode: ragIndexMode,
      chunkSize,
      chunkOverlap,
      embeddingDims,
    });
  };

  const applyDelayFields = () => {
    if (runLocked || selection.graphNodeType !== GRAPH_NODE_TYPE_DELAY) {
      return;
    }
    const sec = Number.parseFloat(sleepDurationSec.trim());
    if (!Number.isFinite(sec) || sec <= 0) {
      showInspectorError(
        presentationForInspectorSimple(t, "app.inspector.timerDurationInvalid"),
        "app.inspector.timerDurationInvalid",
      );
      return;
    }
    const durationSec = Math.min(86400, sec);
    const base = isPlainObject(selection.raw) ? { ...selection.raw } : {};
    onApplyNodeData(selection.id, {
      ...base,
      title: typeof base.title === "string" && base.title.trim() !== "" ? base.title : "Delay",
      durationSec,
    });
  };

  const applyDebounceFields = () => {
    if (runLocked || selection.graphNodeType !== GRAPH_NODE_TYPE_DEBOUNCE) {
      return;
    }
    const sec = Number.parseFloat(sleepDurationSec.trim());
    if (!Number.isFinite(sec) || sec <= 0) {
      showInspectorError(
        presentationForInspectorSimple(t, "app.inspector.timerDurationInvalid"),
        "app.inspector.timerDurationInvalid",
      );
      return;
    }
    const durationSec = Math.min(86400, sec);
    const base = isPlainObject(selection.raw) ? { ...selection.raw } : {};
    onApplyNodeData(selection.id, {
      ...base,
      title: typeof base.title === "string" && base.title.trim() !== "" ? base.title : "Debounce",
      durationSec,
    });
  };

  const applyWaitForFields = () => {
    if (runLocked || selection.graphNodeType !== GRAPH_NODE_TYPE_WAIT_FOR) {
      return;
    }
    const mode = waitForMode.trim().toLowerCase();
    if (mode !== "file") {
      showInspectorError(
        presentationForInspectorSimple(t, "app.inspector.waitForModeInvalid"),
        "app.inspector.waitForModeInvalid",
      );
      return;
    }
    const pathTrim = waitForPath.trim();
    if (pathTrim === "") {
      showInspectorError(
        presentationForInspectorSimple(t, "app.inspector.waitForPathRequired"),
        "app.inspector.waitForPathRequired",
      );
      return;
    }
    const toN = Number.parseFloat(waitForTimeoutSec.trim());
    const toP = Number.parseFloat(waitForPollSec.trim());
    if (!Number.isFinite(toN) || toN <= 0 || !Number.isFinite(toP)) {
      showInspectorError(
        presentationForInspectorSimple(t, "app.inspector.waitForTimingInvalid"),
        "app.inspector.waitForTimingInvalid",
      );
      return;
    }
    const base = isPlainObject(selection.raw) ? { ...selection.raw } : {};
    const next: Record<string, unknown> = {
      ...base,
      title: typeof base.title === "string" && base.title.trim() !== "" ? base.title : "Wait for",
      waitMode: "file",
      path: pathTrim,
      timeoutSec: toN,
      pollIntervalSec: toP,
    };
    if (parseWaitForFileParamsFromData(next) === null) {
      showInspectorError(
        presentationForInspectorSimple(t, "app.inspector.waitForTimingInvalid"),
        "app.inspector.waitForTimingInvalid",
      );
      return;
    }
    const p = parseWaitForFileParamsFromData(next)!;
    onApplyNodeData(selection.id, {
      ...next,
      timeoutSec: p.timeoutSec,
      pollIntervalSec: p.pollSec,
    });
  };

  const applySetVariableFields = () => {
    if (runLocked || selection.graphNodeType !== GRAPH_NODE_TYPE_SET_VARIABLE) {
      return;
    }
    const nameTrim = setVarName.trim();
    if (nameTrim === "") {
      showInspectorError(
        presentationForInspectorSimple(t, "app.inspector.setVariableNameRequired"),
        "app.inspector.setVariableNameRequired",
      );
      return;
    }
    const rawJson = setVarValueJson.trim();
    let parsedValue: unknown = null;
    if (setVarOperation !== "delete") {
      const shouldParse = !(setVarOperation === "increment" && (rawJson === "" || rawJson === "null"));
      if (shouldParse) {
        try {
          parsedValue = JSON.parse(setVarValueJson);
        } catch {
          showInspectorError(
            presentationForInspectorSimple(t, "app.inspector.setVariableValueInvalidJson"),
            "app.inspector.setVariableValueInvalidJson",
          );
          return;
        }
      }
    }
    const base = isPlainObject(selection.raw) ? { ...selection.raw } : {};
    const next: Record<string, unknown> = {
      ...base,
      title:
        typeof base.title === "string" && base.title.trim() !== "" ? base.title : "Set variable",
      name: nameTrim,
      operation: setVarOperation,
    };
    delete next.variableName;
    if (setVarOperation === "delete") {
      delete next.value;
    } else if (setVarOperation === "increment" && (rawJson === "" || rawJson === "null")) {
      delete next.value;
    } else {
      next.value = parsedValue;
    }
    onApplyNodeData(selection.id, next);
  };

  const applyLlmAgentFields = () => {
    if (runLocked || selection.graphNodeType !== GRAPH_NODE_TYPE_LLM_AGENT) {
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

  const applyInRunnerAgentFields = () => {
    if (runLocked || selection.graphNodeType !== GRAPH_NODE_TYPE_AGENT) {
      return;
    }
    const miRaw = Number.parseInt(agentMaxIter.trim(), 10);
    const maxIterations = Number.isFinite(miRaw) ? Math.min(50, Math.max(1, miRaw)) : 10;
    const base = isPlainObject(selection.raw) ? { ...selection.raw } : {};
    const next: Record<string, unknown> = {
      ...base,
      title: typeof base.title === "string" && base.title.trim() !== "" ? base.title : "Agent",
      inputText: agentInputText,
      maxIterations,
    };
    const sp = agentSystemPrompt.trim();
    if (sp !== "") {
      next.systemPrompt = agentSystemPrompt;
    } else {
      delete next.systemPrompt;
    }
    onApplyNodeData(selection.id, next);
  };

  const renderStepCache = (opts?: { hideMarkDirtyButton?: boolean }) => (
    <StepCacheInspector
      nodeId={selection.id}
      raw={selection.raw}
      runLocked={runLocked}
      graphDocument={graphDocument}
      getDocumentForStepCacheDirty={getDocumentForStepCacheDirty}
      onApplyNodeData={onApplyNodeData}
      onMarkStepCacheDirtyTransitive={onMarkStepCacheDirtyTransitive}
      hideMarkDirtyButton={opts?.hideMarkDirtyButton ?? false}
    />
  );

  const RegistryInspector = INSPECTOR_REGISTRY[selection.graphNodeType];
  const registryNode = useMemo(
    () => ({
      id: selection.id,
      type: selection.graphNodeType,
      position: { x: 0, y: 0 },
      data: isPlainObject(selection.raw) ? selection.raw : {},
    }),
    [selection.id, selection.graphNodeType, selection.raw],
  );
  const renderRegistry = (opts?: { withStepCache?: boolean }) =>
    RegistryInspector ? (
      <div className="gc-inspector-mcp">
        <RegistryInspector
          node={registryNode}
          graphDocument={graphDocument}
          runLocked={runLocked}
          workspaceLinked={workspaceLinked}
          onApplyNodeData={onApplyNodeData}
        />
        {opts?.withStepCache !== false ? renderStepCache() : null}
      </div>
    ) : null;

  return (
    <div className="gc-inspector-detail">
      <div className="gc-inspector-row">
        <span className="gc-inspector-k">{t("app.inspector.nodeId")}</span>
        <span className="gc-inspector-v">{selection.id}</span>
      </div>
      <div className="gc-inspector-row">
        <span className="gc-inspector-k">{t("app.inspector.nodeType")}</span>
        <span className="gc-inspector-v">{selection.graphNodeType}</span>
      </div>
      {(() => {
        const dk = `app.inspector.nodeTypeDesc.${selection.graphNodeType}` as const;
        const desc = t(dk, { defaultValue: "" });
        if (desc === "" || desc === dk) {
          return null;
        }
        return <p className="gc-inspector-type-desc">{desc}</p>;
      })()}
      <div className="gc-inspector-row">
        <span className="gc-inspector-k">{t("app.inspector.label")}</span>
        <span className="gc-inspector-v">{selection.label}</span>
      </div>
      <div className="gc-inspector-row gc-inspector-row--field">
        <label className="gc-inspector-k" htmlFor="gc-inspector-expr-monaco">
          {t("app.inspector.expressionMonaco")}
        </label>
        <input
          id="gc-inspector-expr-monaco"
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
      {RegistryInspector && selection.graphNodeType !== GRAPH_NODE_TYPE_TASK ? renderRegistry() : null}
      {selection.graphNodeType === GRAPH_NODE_TYPE_RAG_INDEX ? (
        <div className="gc-inspector-mcp">
          <p className="gc-inspector-edge-hint">{t("app.inspector.ragIndexHeading")}</p>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-inspector-ragix-cid">
              {t("app.inspector.ragIndexCollectionId")}
            </label>
            <input
              id="gc-inspector-ragix-cid"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              spellCheck={false}
              value={ragIndexCollectionId}
              onChange={(ev) => {
                setRagIndexCollectionId(ev.target.value);
              }}
            />
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-inspector-ragix-text">
              {t("app.inspector.ragIndexText")}
            </label>
            <textarea
              id="gc-inspector-ragix-text"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              rows={4}
              spellCheck={false}
              value={ragIndexText}
              onChange={(ev) => {
                setRagIndexText(ev.target.value);
              }}
            />
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-inspector-ragix-mode">
              {t("app.inspector.ragIndexMode")}
            </label>
            <select
              id="gc-inspector-ragix-mode"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              value={ragIndexMode}
              onChange={(ev) => {
                const v = ev.target.value;
                setRagIndexMode(v === "append" ? "append" : "replace");
              }}
            >
              <option value="replace">{t("app.inspector.ragIndexModeReplace")}</option>
              <option value="append">{t("app.inspector.ragIndexModeAppend")}</option>
            </select>
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-inspector-ragix-cs">
              {t("app.inspector.ragIndexChunkSize")}
            </label>
            <input
              id="gc-inspector-ragix-cs"
              type="text"
              inputMode="numeric"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              value={ragIndexChunkSize}
              onChange={(ev) => {
                setRagIndexChunkSize(ev.target.value);
              }}
            />
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-inspector-ragix-co">
              {t("app.inspector.ragIndexChunkOverlap")}
            </label>
            <input
              id="gc-inspector-ragix-co"
              type="text"
              inputMode="numeric"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              value={ragIndexChunkOverlap}
              onChange={(ev) => {
                setRagIndexChunkOverlap(ev.target.value);
              }}
            />
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-inspector-ragix-ed">
              {t("app.inspector.ragIndexEmbeddingDims")}
            </label>
            <input
              id="gc-inspector-ragix-ed"
              type="text"
              inputMode="numeric"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              value={ragIndexEmbeddingDims}
              onChange={(ev) => {
                setRagIndexEmbeddingDims(ev.target.value);
              }}
            />
          </div>
          <button
            type="button"
            className="gc-btn gc-inspector-apply"
            disabled={runLocked}
            onClick={applyRagIndexFields}
          >
            {t("app.inspector.applyRagIndexSettings")}
          </button>
          {renderStepCache({ hideMarkDirtyButton: true })}
        </div>
      ) : null}
      {selection.graphNodeType === GRAPH_NODE_TYPE_DELAY ? (
        <div className="gc-inspector-mcp">
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-inspector-delay-dur">
              {t("app.inspector.timerDurationSec")}
            </label>
            <input
              id="gc-inspector-delay-dur"
              type="text"
              inputMode="decimal"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              value={sleepDurationSec}
              onChange={(ev) => {
                setSleepDurationSec(ev.target.value);
              }}
            />
            <p className="gc-inspector-edge-hint">{t("app.inspector.timerDurationHint")}</p>
          </div>
          <button
            type="button"
            className="gc-btn gc-inspector-apply"
            disabled={runLocked}
            onClick={applyDelayFields}
          >
            {t("app.inspector.applyDelaySettings")}
          </button>
          {renderStepCache()}
        </div>
      ) : null}
      {selection.graphNodeType === GRAPH_NODE_TYPE_DEBOUNCE ? (
        <div className="gc-inspector-mcp">
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-inspector-debounce-dur">
              {t("app.inspector.timerDurationSec")}
            </label>
            <input
              id="gc-inspector-debounce-dur"
              type="text"
              inputMode="decimal"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              value={sleepDurationSec}
              onChange={(ev) => {
                setSleepDurationSec(ev.target.value);
              }}
            />
            <p className="gc-inspector-edge-hint">{t("app.inspector.timerDurationHint")}</p>
          </div>
          <button
            type="button"
            className="gc-btn gc-inspector-apply"
            disabled={runLocked}
            onClick={applyDebounceFields}
          >
            {t("app.inspector.applyDebounceSettings")}
          </button>
          {renderStepCache()}
        </div>
      ) : null}
      {selection.graphNodeType === GRAPH_NODE_TYPE_WAIT_FOR ? (
        <div className="gc-inspector-mcp">
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-inspector-wait-mode">
              {t("app.inspector.waitForMode")}
            </label>
            <select
              id="gc-inspector-wait-mode"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              value={waitForMode}
              onChange={(ev) => {
                setWaitForMode(ev.target.value);
              }}
            >
              <option value="file">{t("app.inspector.waitForModeFile")}</option>
            </select>
            <p className="gc-inspector-edge-hint">{t("app.inspector.waitForModeHint")}</p>
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-inspector-wait-path">
              {t("app.inspector.waitForPath")}
            </label>
            <input
              id="gc-inspector-wait-path"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              spellCheck={false}
              value={waitForPath}
              onChange={(ev) => {
                setWaitForPath(ev.target.value);
              }}
            />
            <p className="gc-inspector-edge-hint">{t("app.inspector.waitForPathHint")}</p>
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-inspector-wait-timeout">
              {t("app.inspector.waitForTimeoutSec")}
            </label>
            <input
              id="gc-inspector-wait-timeout"
              type="text"
              inputMode="decimal"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              value={waitForTimeoutSec}
              onChange={(ev) => {
                setWaitForTimeoutSec(ev.target.value);
              }}
            />
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-inspector-wait-poll">
              {t("app.inspector.waitForPollSec")}
            </label>
            <input
              id="gc-inspector-wait-poll"
              type="text"
              inputMode="decimal"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              value={waitForPollSec}
              onChange={(ev) => {
                setWaitForPollSec(ev.target.value);
              }}
            />
            <p className="gc-inspector-edge-hint">{t("app.inspector.waitForPollHint")}</p>
          </div>
          <button
            type="button"
            className="gc-btn gc-inspector-apply"
            disabled={runLocked}
            onClick={applyWaitForFields}
          >
            {t("app.inspector.applyWaitForSettings")}
          </button>
          {renderStepCache()}
        </div>
      ) : null}
      {selection.graphNodeType === GRAPH_NODE_TYPE_SET_VARIABLE ? (
        <div className="gc-inspector-mcp">
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-inspector-setvar-name">
              {t("app.inspector.setVariableName")}
            </label>
            <input
              id="gc-inspector-setvar-name"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              spellCheck={false}
              autoComplete="off"
              value={setVarName}
              onChange={(ev) => {
                setSetVarName(ev.target.value);
              }}
            />
            <p className="gc-inspector-edge-hint">{t("app.inspector.setVariableNameHint")}</p>
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-inspector-setvar-op">
              {t("app.inspector.setVariableOperation")}
            </label>
            <select
              id="gc-inspector-setvar-op"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              value={setVarOperation}
              onChange={(ev) => {
                const v = ev.target.value;
                if (v === "increment" || v === "append" || v === "delete" || v === "set") {
                  setSetVarOperation(v);
                }
              }}
            >
              <option value="set">{t("app.inspector.setVariableOpSet")}</option>
              <option value="increment">{t("app.inspector.setVariableOpIncrement")}</option>
              <option value="append">{t("app.inspector.setVariableOpAppend")}</option>
              <option value="delete">{t("app.inspector.setVariableOpDelete")}</option>
            </select>
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-inspector-setvar-val">
              {t("app.inspector.setVariableValueJson")}
            </label>
            <textarea
              id="gc-inspector-setvar-val"
              className="gc-inspector-condition-input"
              disabled={runLocked || setVarOperation === "delete"}
              rows={4}
              spellCheck={false}
              value={setVarValueJson}
              onChange={(ev) => {
                setSetVarValueJson(ev.target.value);
              }}
            />
            <p className="gc-inspector-edge-hint">{t("app.inspector.setVariableValueHint")}</p>
          </div>
          <button
            type="button"
            className="gc-btn gc-inspector-apply"
            disabled={runLocked}
            onClick={applySetVariableFields}
          >
            {t("app.inspector.applySetVariableSettings")}
          </button>
        </div>
      ) : null}
      {selection.graphNodeType === GRAPH_NODE_TYPE_LLM_AGENT ? (
        <div className="gc-inspector-mcp">
          {renderStepCache()}
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
      {selection.graphNodeType === GRAPH_NODE_TYPE_AGENT ? (
        <div className="gc-inspector-mcp">
          {renderStepCache()}
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-inspector-agent-input">
              {t("app.inspector.agentInputText")}
            </label>
            <textarea
              id="gc-inspector-agent-input"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              rows={4}
              spellCheck={false}
              value={agentInputText}
              onChange={(ev) => {
                setAgentInputText(ev.target.value);
              }}
            />
            <p className="gc-inspector-edge-hint">{t("app.inspector.agentInputTextHint")}</p>
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-inspector-agent-sys">
              {t("app.inspector.agentSystemPrompt")}
            </label>
            <textarea
              id="gc-inspector-agent-sys"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              rows={3}
              spellCheck={false}
              value={agentSystemPrompt}
              onChange={(ev) => {
                setAgentSystemPrompt(ev.target.value);
              }}
            />
          </div>
          <div className="gc-inspector-row gc-inspector-row--field">
            <label className="gc-inspector-k" htmlFor="gc-inspector-agent-maxiter">
              {t("app.inspector.agentMaxIterations")}
            </label>
            <input
              id="gc-inspector-agent-maxiter"
              type="text"
              inputMode="numeric"
              className="gc-inspector-condition-input"
              disabled={runLocked}
              value={agentMaxIter}
              onChange={(ev) => {
                setAgentMaxIter(ev.target.value);
              }}
            />
            <p className="gc-inspector-edge-hint">{t("app.inspector.agentMaxIterationsHint")}</p>
          </div>
          <button
            type="button"
            className="gc-btn gc-inspector-apply"
            disabled={runLocked}
            onClick={applyInRunnerAgentFields}
          >
            {t("app.inspector.applyAgentNodeSettings")}
          </button>
        </div>
      ) : null}
      {httpRequestEndpointHref != null ? (
        <div className="gc-inspector-url-row">
          <a
            href={httpRequestEndpointHref}
            target="_blank"
            rel="noopener noreferrer"
            className="gc-inspector-external-link"
          >
            {t("app.inspector.openHttpRequestUrl")}
          </a>
          <span className="gc-inspector-url-preview" title={httpRequestEndpointHref}>
            {httpRequestEndpointHref.length > 72
              ? `${httpRequestEndpointHref.slice(0, 69)}…`
              : httpRequestEndpointHref}
          </span>
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
      {selection.graphNodeType === GRAPH_NODE_TYPE_AI_ROUTE ? renderStepCache() : null}
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
                  nodeOutputSnapshots[selection.id] === undefined
                }
                onClick={() => {
                  const snap = nodeOutputSnapshots[selection.id];
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
          {renderStepCache()}
          {RegistryInspector ? (
            <RegistryInspector
              node={registryNode}
              graphDocument={graphDocument}
              runLocked={runLocked}
              workspaceLinked={workspaceLinked}
              onApplyNodeData={onApplyNodeData}
            />
          ) : null}
        </>
      ) : null}
      {isGraphDocumentFrameType(selection.graphNodeType) ? (
        <p className="gc-inspector-edge-hint">
          {selection.graphNodeType === GRAPH_NODE_TYPE_GROUP
            ? t("app.inspector.groupFrameHint")
            : t("app.inspector.commentFrameHint")}
        </p>
      ) : null}
      {selection.graphNodeType === GRAPH_NODE_TYPE_TRIGGER_WEBHOOK ||
      selection.graphNodeType === GRAPH_NODE_TYPE_TRIGGER_SCHEDULE ? (
        <p className="gc-inspector-edge-hint">
          {selection.graphNodeType === GRAPH_NODE_TYPE_TRIGGER_WEBHOOK
            ? t("app.inspector.triggerWebhookHint")
            : t("app.inspector.triggerScheduleHint")}
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
                {graphRefWorkspaceHintState.kind === "noop" &&
                graphRefSelectionTargetId !== "" &&
                getGraphRefWorkspaceHint == null ? (
                  <p className="gc-inspector-edge-hint">
                    {t("app.inspector.graphRefPreviewTargetIdFallback", {
                      id: graphRefSelectionTargetId,
                    })}
                  </p>
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
  );
}
