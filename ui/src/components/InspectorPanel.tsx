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
  GRAPH_NODE_TYPE_HTTP_REQUEST,
  GRAPH_NODE_TYPE_RAG_QUERY,
  GRAPH_NODE_TYPE_RAG_INDEX,
  GRAPH_NODE_TYPE_DELAY,
  GRAPH_NODE_TYPE_DEBOUNCE,
  GRAPH_NODE_TYPE_WAIT_FOR,
  GRAPH_NODE_TYPE_SET_VARIABLE,
  GRAPH_NODE_TYPE_PYTHON_CODE,
  GRAPH_NODE_TYPE_LLM_AGENT,
  GRAPH_NODE_TYPE_AGENT,
  GRAPH_NODE_TYPE_GROUP,
  GRAPH_NODE_TYPE_TASK,
  isGraphDocumentFrameType,
} from "../graph/nodeKinds";
import { runSessionAppendLine, useRunSession } from "../run/runSessionStore";
import {
  getStepCacheDirtySnapshot,
  markStepCacheDirtyTransitive,
} from "../run/stepCacheDirtyStore";
import { mergeModeFromNodeData, parseWaitForFileParamsFromData } from "../graph/structureWarnings";
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

function agentPromptFromNodeRaw(raw: Record<string, unknown>): string {
  for (const key of ["inputText", "input", "prompt", "userMessage"] as const) {
    const v = raw[key];
    if (typeof v === "string" && v.trim() !== "") {
      return v;
    }
  }
  return "";
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

function logGraphRefPreviewUnexpected(err: unknown): void {
  if (import.meta.env.DEV) {
    console.error("[InspectorPanel] loadGraphRefSnapshot rejected unexpectedly", err);
  }
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

  const [httpUrl, setHttpUrl] = useState("");
  const [httpMethod, setHttpMethod] = useState("GET");
  const [httpHeadersJson, setHttpHeadersJson] = useState("{}");
  const [httpBody, setHttpBody] = useState("");
  const [httpTimeoutSec, setHttpTimeoutSec] = useState("30");
  const [httpVerifyTls, setHttpVerifyTls] = useState(true);
  const [httpParseResponse, setHttpParseResponse] = useState<"auto" | "json" | "text">("auto");
  const [httpAuthKind, setHttpAuthKind] = useState<"none" | "basic" | "bearer">("none");
  const [httpAuthUser, setHttpAuthUser] = useState("");
  const [httpAuthPassword, setHttpAuthPassword] = useState("");
  const [httpAuthToken, setHttpAuthToken] = useState("");

  const [ragUrl, setRagUrl] = useState("");
  const [ragQuery, setRagQuery] = useState("");
  const [ragCollectionId, setRagCollectionId] = useState("");
  const [ragTopK, setRagTopK] = useState("5");
  const [ragMethod, setRagMethod] = useState("POST");
  const [ragHeadersJson, setRagHeadersJson] = useState("{}");
  const [ragBody, setRagBody] = useState("");
  const [ragTimeoutSec, setRagTimeoutSec] = useState("60");
  const [ragVerifyTls, setRagVerifyTls] = useState(true);
  const [ragParseResponse, setRagParseResponse] = useState<"auto" | "json" | "text">("auto");
  const [ragVectorBackend, setRagVectorBackend] = useState<"http" | "memory">("http");

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

  const [pyCode, setPyCode] = useState("");
  const [pyTimeoutSec, setPyTimeoutSec] = useState("30");

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

    // n8n/Dify-style: load nested workflow metadata when the ref node is selected (no extra click).
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
    if (selection?.kind === "node" && selection.graphNodeType === GRAPH_NODE_TYPE_HTTP_REQUEST) {
      const r = selection.raw;
      setHttpUrl(typeof r.url === "string" ? r.url : "");
      const m0 = typeof r.method === "string" && r.method.trim() !== "" ? r.method.trim().toUpperCase() : "GET";
      setHttpMethod(m0);
      const hh = r.headers;
      try {
        setHttpHeadersJson(
          JSON.stringify(hh != null && typeof hh === "object" && !Array.isArray(hh) ? hh : {}, null, 2),
        );
      } catch {
        setHttpHeadersJson("{}");
      }
      setHttpBody(typeof r.body === "string" ? r.body : "");
      const hts = r.timeoutSec;
      setHttpTimeoutSec(
        typeof hts === "number" && Number.isFinite(hts)
          ? String(hts)
          : typeof hts === "string" && hts.trim() !== ""
            ? hts.trim()
            : "30",
      );
      setHttpVerifyTls(r.verifyTls !== false);
      const pr = typeof r.parseResponseBody === "string" ? r.parseResponseBody.trim().toLowerCase() : "auto";
      setHttpParseResponse(pr === "json" || pr === "text" ? pr : "auto");
      const auth = r.auth;
      if (isPlainObject(auth)) {
        const at = String(auth.type || "").toLowerCase();
        if (at === "basic") {
          setHttpAuthKind("basic");
          setHttpAuthUser(typeof auth.username === "string" ? auth.username : "");
          setHttpAuthPassword(typeof auth.password === "string" ? auth.password : "");
          setHttpAuthToken("");
        } else if (at === "bearer") {
          setHttpAuthKind("bearer");
          setHttpAuthToken(typeof auth.token === "string" ? auth.token : "");
          setHttpAuthUser("");
          setHttpAuthPassword("");
        } else {
          setHttpAuthKind("none");
          setHttpAuthUser("");
          setHttpAuthPassword("");
          setHttpAuthToken("");
        }
      } else {
        setHttpAuthKind("none");
        setHttpAuthUser("");
        setHttpAuthPassword("");
        setHttpAuthToken("");
      }
    }
    if (selection?.kind === "node" && selection.graphNodeType === GRAPH_NODE_TYPE_RAG_QUERY) {
      const r = selection.raw;
      const vb = String((r as Record<string, unknown>).vectorBackend ?? "").trim().toLowerCase();
      setRagVectorBackend(vb === "memory" ? "memory" : "http");
      setRagUrl(typeof r.url === "string" ? r.url : "");
      setRagQuery(typeof r.query === "string" ? r.query : "");
      setRagCollectionId(typeof r.collectionId === "string" ? r.collectionId : "");
      const tk = r.topK;
      setRagTopK(
        typeof tk === "number" && Number.isFinite(tk)
          ? String(Math.trunc(tk))
          : typeof tk === "string" && tk.trim() !== ""
            ? tk.trim()
            : "5",
      );
      const rm = typeof r.method === "string" && r.method.trim() !== "" ? r.method.trim().toUpperCase() : "POST";
      setRagMethod(rm);
      const rh = r.headers;
      try {
        setRagHeadersJson(
          JSON.stringify(rh != null && typeof rh === "object" && !Array.isArray(rh) ? rh : {}, null, 2),
        );
      } catch {
        setRagHeadersJson("{}");
      }
      setRagBody(typeof r.body === "string" ? r.body : "");
      const rts = r.timeoutSec;
      setRagTimeoutSec(
        typeof rts === "number" && Number.isFinite(rts)
          ? String(rts)
          : typeof rts === "string" && rts.trim() !== ""
            ? rts.trim()
            : "60",
      );
      setRagVerifyTls(r.verifyTls !== false);
      const rpr = typeof r.parseResponseBody === "string" ? r.parseResponseBody.trim().toLowerCase() : "auto";
      setRagParseResponse(rpr === "json" || rpr === "text" ? rpr : "auto");
      const rauth = r.auth;
      if (isPlainObject(rauth)) {
        const at = String(rauth.type || "").toLowerCase();
        if (at === "basic") {
          setHttpAuthKind("basic");
          setHttpAuthUser(typeof rauth.username === "string" ? rauth.username : "");
          setHttpAuthPassword(typeof rauth.password === "string" ? rauth.password : "");
          setHttpAuthToken("");
        } else if (at === "bearer") {
          setHttpAuthKind("bearer");
          setHttpAuthToken(typeof rauth.token === "string" ? rauth.token : "");
          setHttpAuthUser("");
          setHttpAuthPassword("");
        } else {
          setHttpAuthKind("none");
          setHttpAuthUser("");
          setHttpAuthPassword("");
          setHttpAuthToken("");
        }
      } else {
        setHttpAuthKind("none");
        setHttpAuthUser("");
        setHttpAuthPassword("");
        setHttpAuthToken("");
      }
    }
    if (selection?.kind === "node" && selection.graphNodeType === GRAPH_NODE_TYPE_RAG_INDEX) {
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
      selection?.kind === "node" &&
      (selection.graphNodeType === GRAPH_NODE_TYPE_DELAY ||
        selection.graphNodeType === GRAPH_NODE_TYPE_DEBOUNCE)
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
    if (selection?.kind === "node" && selection.graphNodeType === GRAPH_NODE_TYPE_WAIT_FOR) {
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
    if (selection?.kind === "node" && selection.graphNodeType === GRAPH_NODE_TYPE_SET_VARIABLE) {
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
    if (selection?.kind === "node" && selection.graphNodeType === GRAPH_NODE_TYPE_PYTHON_CODE) {
      const r = selection.raw;
      setPyCode(typeof r.code === "string" ? r.code : "");
      const pts = r.timeoutSec;
      setPyTimeoutSec(
        typeof pts === "number" && Number.isFinite(pts)
          ? String(pts)
          : typeof pts === "string" && pts.trim() !== ""
            ? pts.trim()
            : "30",
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
    if (selection?.kind === "node" && selection.graphNodeType === GRAPH_NODE_TYPE_AGENT) {
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

  const httpRequestEndpointHref = useMemo(() => {
    if (
      selection?.kind !== "node" ||
      (selection.graphNodeType !== GRAPH_NODE_TYPE_HTTP_REQUEST &&
        selection.graphNodeType !== GRAPH_NODE_TYPE_RAG_QUERY)
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

  const applyHttpRequestFields = () => {
    if (
      runLocked ||
      selection?.kind !== "node" ||
      selection.graphNodeType !== GRAPH_NODE_TYPE_HTTP_REQUEST
    ) {
      return;
    }
    let headersObj: Record<string, unknown>;
    try {
      const p = JSON.parse(httpHeadersJson);
      if (!isPlainObject(p)) {
        throw new Error("not_object");
      }
      headersObj = p;
    } catch {
      showInspectorError(
        presentationForInspectorSimple(t, "app.inspector.httpRequestHeadersInvalid"),
        "app.inspector.httpRequestHeadersInvalid",
      );
      return;
    }
    const toN = Number.parseFloat(httpTimeoutSec);
    const timeoutSec = Number.isFinite(toN) ? Math.min(3600, Math.max(0.5, toN)) : 30;
    const base = isPlainObject(selection.raw) ? { ...selection.raw } : {};
    const next: Record<string, unknown> = {
      ...base,
      title: typeof base.title === "string" && base.title.trim() !== "" ? base.title : "HTTP request",
      url: httpUrl,
      method: httpMethod.trim() !== "" ? httpMethod.trim().toUpperCase() : "GET",
      headers: headersObj,
      timeoutSec,
      verifyTls: httpVerifyTls,
      parseResponseBody: httpParseResponse,
    };
    const bTrim = httpBody.trim();
    if (bTrim !== "") {
      next.body = httpBody;
    } else {
      delete next.body;
    }
    if (httpAuthKind === "basic") {
      next.auth = { type: "basic", username: httpAuthUser, password: httpAuthPassword };
    } else if (httpAuthKind === "bearer") {
      next.auth = { type: "bearer", token: httpAuthToken };
    } else {
      delete next.auth;
    }
    onApplyNodeData(selection.id, next);
  };

  const applyRagQueryFields = () => {
    if (
      runLocked ||
      selection?.kind !== "node" ||
      selection.graphNodeType !== GRAPH_NODE_TYPE_RAG_QUERY
    ) {
      return;
    }
    const toK = Number.parseInt(ragTopK, 10);
    const topK = Number.isFinite(toK) ? Math.min(100, Math.max(1, toK)) : 5;
    const base = isPlainObject(selection.raw) ? { ...selection.raw } : {};
    const title =
      typeof base.title === "string" && base.title.trim() !== "" ? base.title : "RAG query";
    const next: Record<string, unknown> = {
      ...base,
      title,
      query: ragQuery,
      topK,
    };
    const cTrim = ragCollectionId.trim();
    if (cTrim !== "") {
      next.collectionId = ragCollectionId;
    } else {
      delete next.collectionId;
    }
    if (ragVectorBackend === "memory") {
      next.vectorBackend = "memory";
      delete next.url;
      delete next.method;
      delete next.headers;
      delete next.body;
      delete next.auth;
      delete next.timeoutSec;
      delete next.verifyTls;
      delete next.parseResponseBody;
      onApplyNodeData(selection.id, next);
      return;
    }
    delete next.vectorBackend;
    let headersObj: Record<string, unknown>;
    try {
      const p = JSON.parse(ragHeadersJson);
      if (!isPlainObject(p)) {
        throw new Error("not_object");
      }
      headersObj = p;
    } catch {
      showInspectorError(
        presentationForInspectorSimple(t, "app.inspector.httpRequestHeadersInvalid"),
        "app.inspector.httpRequestHeadersInvalid",
      );
      return;
    }
    const toN = Number.parseFloat(ragTimeoutSec);
    const timeoutSec = Number.isFinite(toN) ? Math.min(3600, Math.max(0.5, toN)) : 60;
    next.url = ragUrl;
    next.method = ragMethod.trim() !== "" ? ragMethod.trim().toUpperCase() : "POST";
    next.headers = headersObj;
    next.timeoutSec = timeoutSec;
    next.verifyTls = ragVerifyTls;
    next.parseResponseBody = ragParseResponse;
    const bTrim = ragBody.trim();
    if (bTrim !== "") {
      next.body = ragBody;
    } else {
      delete next.body;
    }
    if (httpAuthKind === "basic") {
      next.auth = { type: "basic", username: httpAuthUser, password: httpAuthPassword };
    } else if (httpAuthKind === "bearer") {
      next.auth = { type: "bearer", token: httpAuthToken };
    } else {
      delete next.auth;
    }
    onApplyNodeData(selection.id, next);
  };

  const applyRagIndexFields = () => {
    if (
      runLocked ||
      selection?.kind !== "node" ||
      selection.graphNodeType !== GRAPH_NODE_TYPE_RAG_INDEX
    ) {
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
    if (runLocked || selection?.kind !== "node" || selection.graphNodeType !== GRAPH_NODE_TYPE_DELAY) {
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
    if (runLocked || selection?.kind !== "node" || selection.graphNodeType !== GRAPH_NODE_TYPE_DEBOUNCE) {
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
    if (runLocked || selection?.kind !== "node" || selection.graphNodeType !== GRAPH_NODE_TYPE_WAIT_FOR) {
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
    if (runLocked || selection?.kind !== "node" || selection.graphNodeType !== GRAPH_NODE_TYPE_SET_VARIABLE) {
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

  const applyPythonCodeFields = () => {
    if (
      runLocked ||
      selection?.kind !== "node" ||
      selection.graphNodeType !== GRAPH_NODE_TYPE_PYTHON_CODE
    ) {
      return;
    }
    const toN = Number.parseFloat(pyTimeoutSec);
    const timeoutSec = Number.isFinite(toN) ? Math.min(3600, Math.max(0.5, toN)) : 30;
    const base = isPlainObject(selection.raw) ? { ...selection.raw } : {};
    const next: Record<string, unknown> = {
      ...base,
      title: typeof base.title === "string" && base.title.trim() !== "" ? base.title : "Python code",
      code: pyCode,
      timeoutSec,
    };
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

  const applyInRunnerAgentFields = () => {
    if (runLocked || selection?.kind !== "node" || selection.graphNodeType !== GRAPH_NODE_TYPE_AGENT) {
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
                    <p className="gc-inspector-edge-hint">{t("app.inspector.mcpOauthGithubHint")}</p>
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
          {selection.graphNodeType === GRAPH_NODE_TYPE_HTTP_REQUEST ? (
            <div className="gc-inspector-mcp">
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-http-url">
                  {t("app.inspector.httpRequestUrl")}
                </label>
                <input
                  id="gc-inspector-http-url"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  spellCheck={false}
                  value={httpUrl}
                  onChange={(ev) => {
                    setHttpUrl(ev.target.value);
                  }}
                />
                <p className="gc-inspector-edge-hint">{t("app.inspector.httpRequestUrlHint")}</p>
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-http-method">
                  {t("app.inspector.httpRequestMethod")}
                </label>
                <select
                  id="gc-inspector-http-method"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  value={httpMethod}
                  onChange={(ev) => {
                    setHttpMethod(ev.target.value);
                  }}
                >
                  <option value="GET">GET</option>
                  <option value="HEAD">HEAD</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                  <option value="DELETE">DELETE</option>
                  <option value="OPTIONS">OPTIONS</option>
                </select>
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-http-headers">
                  {t("app.inspector.httpRequestHeadersJson")}
                </label>
                <textarea
                  id="gc-inspector-http-headers"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  rows={4}
                  spellCheck={false}
                  value={httpHeadersJson}
                  onChange={(ev) => {
                    setHttpHeadersJson(ev.target.value);
                  }}
                />
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-http-body">
                  {t("app.inspector.httpRequestBody")}
                </label>
                <textarea
                  id="gc-inspector-http-body"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  rows={4}
                  spellCheck={false}
                  value={httpBody}
                  onChange={(ev) => {
                    setHttpBody(ev.target.value);
                  }}
                />
                <p className="gc-inspector-edge-hint">{t("app.inspector.httpRequestBodyHint")}</p>
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-http-timeout">
                  {t("app.inspector.httpRequestTimeoutSec")}
                </label>
                <input
                  id="gc-inspector-http-timeout"
                  type="text"
                  inputMode="decimal"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  value={httpTimeoutSec}
                  onChange={(ev) => {
                    setHttpTimeoutSec(ev.target.value);
                  }}
                />
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-http-verify">
                  {t("app.inspector.httpRequestVerifyTls")}
                </label>
                <input
                  id="gc-inspector-http-verify"
                  type="checkbox"
                  disabled={runLocked}
                  checked={httpVerifyTls}
                  onChange={(ev) => {
                    setHttpVerifyTls(ev.target.checked);
                  }}
                />
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-http-parse">
                  {t("app.inspector.httpRequestParseBody")}
                </label>
                <select
                  id="gc-inspector-http-parse"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  value={httpParseResponse}
                  onChange={(ev) => {
                    const v = ev.target.value;
                    setHttpParseResponse(v === "json" || v === "text" ? v : "auto");
                  }}
                >
                  <option value="auto">{t("app.inspector.httpRequestParseAuto")}</option>
                  <option value="json">{t("app.inspector.httpRequestParseJson")}</option>
                  <option value="text">{t("app.inspector.httpRequestParseText")}</option>
                </select>
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-http-auth-kind">
                  {t("app.inspector.httpRequestAuthKind")}
                </label>
                <select
                  id="gc-inspector-http-auth-kind"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  value={httpAuthKind}
                  onChange={(ev) => {
                    const v = ev.target.value;
                    setHttpAuthKind(v === "basic" || v === "bearer" ? v : "none");
                  }}
                >
                  <option value="none">{t("app.inspector.httpRequestAuthNone")}</option>
                  <option value="basic">{t("app.inspector.httpRequestAuthBasic")}</option>
                  <option value="bearer">{t("app.inspector.httpRequestAuthBearer")}</option>
                </select>
              </div>
              {httpAuthKind === "basic" ? (
                <>
                  <div className="gc-inspector-row gc-inspector-row--field">
                    <label className="gc-inspector-k" htmlFor="gc-inspector-http-auth-user">
                      {t("app.inspector.httpRequestAuthUsername")}
                    </label>
                    <input
                      id="gc-inspector-http-auth-user"
                      className="gc-inspector-condition-input"
                      disabled={runLocked}
                      autoComplete="off"
                      value={httpAuthUser}
                      onChange={(ev) => {
                        setHttpAuthUser(ev.target.value);
                      }}
                    />
                  </div>
                  <div className="gc-inspector-row gc-inspector-row--field">
                    <label className="gc-inspector-k" htmlFor="gc-inspector-http-auth-pass">
                      {t("app.inspector.httpRequestAuthPassword")}
                    </label>
                    <input
                      id="gc-inspector-http-auth-pass"
                      type="password"
                      className="gc-inspector-condition-input"
                      disabled={runLocked}
                      autoComplete="off"
                      value={httpAuthPassword}
                      onChange={(ev) => {
                        setHttpAuthPassword(ev.target.value);
                      }}
                    />
                  </div>
                </>
              ) : null}
              {httpAuthKind === "bearer" ? (
                <div className="gc-inspector-row gc-inspector-row--field">
                  <label className="gc-inspector-k" htmlFor="gc-inspector-http-auth-token">
                    {t("app.inspector.httpRequestAuthToken")}
                  </label>
                  <input
                    id="gc-inspector-http-auth-token"
                    type="password"
                    className="gc-inspector-condition-input"
                    disabled={runLocked}
                    autoComplete="off"
                    value={httpAuthToken}
                    onChange={(ev) => {
                      setHttpAuthToken(ev.target.value);
                    }}
                  />
                </div>
              ) : null}
              <button
                type="button"
                className="gc-btn gc-inspector-apply"
                disabled={runLocked}
                onClick={applyHttpRequestFields}
              >
                {t("app.inspector.applyHttpRequestSettings")}
              </button>
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
            </div>
          ) : null}
          {selection.graphNodeType === GRAPH_NODE_TYPE_RAG_QUERY ? (
            <div className="gc-inspector-mcp">
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-rag-vb">
                  {t("app.inspector.ragQueryVectorBackend")}
                </label>
                <select
                  id="gc-inspector-rag-vb"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  value={ragVectorBackend}
                  onChange={(ev) => {
                    const v = ev.target.value;
                    setRagVectorBackend(v === "memory" ? "memory" : "http");
                  }}
                >
                  <option value="http">{t("app.inspector.ragQueryVectorBackendHttp")}</option>
                  <option value="memory">{t("app.inspector.ragQueryVectorBackendMemory")}</option>
                </select>
                <p className="gc-inspector-edge-hint">{t("app.inspector.ragQueryVectorBackendHint")}</p>
              </div>
              {ragVectorBackend !== "memory" ? (
                <div className="gc-inspector-row gc-inspector-row--field">
                  <label className="gc-inspector-k" htmlFor="gc-inspector-rag-url">
                    {t("app.inspector.ragQueryUrl")}
                  </label>
                  <input
                    id="gc-inspector-rag-url"
                    className="gc-inspector-condition-input"
                    disabled={runLocked}
                    spellCheck={false}
                    value={ragUrl}
                    onChange={(ev) => {
                      setRagUrl(ev.target.value);
                    }}
                  />
                  <p className="gc-inspector-edge-hint">{t("app.inspector.ragQueryUrlHint")}</p>
                </div>
              ) : null}
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-rag-query">
                  {t("app.inspector.ragQueryQueryText")}
                </label>
                <textarea
                  id="gc-inspector-rag-query"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  rows={3}
                  spellCheck={false}
                  value={ragQuery}
                  onChange={(ev) => {
                    setRagQuery(ev.target.value);
                  }}
                />
                <p className="gc-inspector-edge-hint">{t("app.inspector.ragQueryQueryHint")}</p>
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-rag-collection">
                  {t("app.inspector.ragQueryCollectionId")}
                </label>
                <input
                  id="gc-inspector-rag-collection"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  spellCheck={false}
                  value={ragCollectionId}
                  onChange={(ev) => {
                    setRagCollectionId(ev.target.value);
                  }}
                />
                <p className="gc-inspector-edge-hint">{t("app.inspector.ragQueryCollectionHint")}</p>
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-rag-topk">
                  {t("app.inspector.ragQueryTopK")}
                </label>
                <input
                  id="gc-inspector-rag-topk"
                  type="text"
                  inputMode="numeric"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  value={ragTopK}
                  onChange={(ev) => {
                    setRagTopK(ev.target.value);
                  }}
                />
                <p className="gc-inspector-edge-hint">{t("app.inspector.ragQueryTopKHint")}</p>
              </div>
              {ragVectorBackend !== "memory" ? (
                <>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-rag-method">
                  {t("app.inspector.httpRequestMethod")}
                </label>
                <select
                  id="gc-inspector-rag-method"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  value={ragMethod}
                  onChange={(ev) => {
                    setRagMethod(ev.target.value);
                  }}
                >
                  <option value="GET">GET</option>
                  <option value="HEAD">HEAD</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                  <option value="DELETE">DELETE</option>
                  <option value="OPTIONS">OPTIONS</option>
                </select>
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-rag-headers">
                  {t("app.inspector.httpRequestHeadersJson")}
                </label>
                <textarea
                  id="gc-inspector-rag-headers"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  rows={4}
                  spellCheck={false}
                  value={ragHeadersJson}
                  onChange={(ev) => {
                    setRagHeadersJson(ev.target.value);
                  }}
                />
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-rag-body">
                  {t("app.inspector.httpRequestBody")}
                </label>
                <textarea
                  id="gc-inspector-rag-body"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  rows={4}
                  spellCheck={false}
                  value={ragBody}
                  onChange={(ev) => {
                    setRagBody(ev.target.value);
                  }}
                />
                <p className="gc-inspector-edge-hint">{t("app.inspector.ragQueryBodyHint")}</p>
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-rag-timeout">
                  {t("app.inspector.httpRequestTimeoutSec")}
                </label>
                <input
                  id="gc-inspector-rag-timeout"
                  type="text"
                  inputMode="decimal"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  value={ragTimeoutSec}
                  onChange={(ev) => {
                    setRagTimeoutSec(ev.target.value);
                  }}
                />
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-rag-verify">
                  {t("app.inspector.httpRequestVerifyTls")}
                </label>
                <input
                  id="gc-inspector-rag-verify"
                  type="checkbox"
                  disabled={runLocked}
                  checked={ragVerifyTls}
                  onChange={(ev) => {
                    setRagVerifyTls(ev.target.checked);
                  }}
                />
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-rag-parse">
                  {t("app.inspector.httpRequestParseBody")}
                </label>
                <select
                  id="gc-inspector-rag-parse"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  value={ragParseResponse}
                  onChange={(ev) => {
                    const v = ev.target.value;
                    setRagParseResponse(v === "json" || v === "text" ? v : "auto");
                  }}
                >
                  <option value="auto">{t("app.inspector.httpRequestParseAuto")}</option>
                  <option value="json">{t("app.inspector.httpRequestParseJson")}</option>
                  <option value="text">{t("app.inspector.httpRequestParseText")}</option>
                </select>
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-rag-auth-kind">
                  {t("app.inspector.httpRequestAuthKind")}
                </label>
                <select
                  id="gc-inspector-rag-auth-kind"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  value={httpAuthKind}
                  onChange={(ev) => {
                    const v = ev.target.value;
                    setHttpAuthKind(v === "basic" || v === "bearer" ? v : "none");
                  }}
                >
                  <option value="none">{t("app.inspector.httpRequestAuthNone")}</option>
                  <option value="basic">{t("app.inspector.httpRequestAuthBasic")}</option>
                  <option value="bearer">{t("app.inspector.httpRequestAuthBearer")}</option>
                </select>
              </div>
              {httpAuthKind === "basic" ? (
                <>
                  <div className="gc-inspector-row gc-inspector-row--field">
                    <label className="gc-inspector-k" htmlFor="gc-inspector-rag-auth-user">
                      {t("app.inspector.httpRequestAuthUsername")}
                    </label>
                    <input
                      id="gc-inspector-rag-auth-user"
                      className="gc-inspector-condition-input"
                      disabled={runLocked}
                      autoComplete="off"
                      value={httpAuthUser}
                      onChange={(ev) => {
                        setHttpAuthUser(ev.target.value);
                      }}
                    />
                  </div>
                  <div className="gc-inspector-row gc-inspector-row--field">
                    <label className="gc-inspector-k" htmlFor="gc-inspector-rag-auth-pass">
                      {t("app.inspector.httpRequestAuthPassword")}
                    </label>
                    <input
                      id="gc-inspector-rag-auth-pass"
                      type="password"
                      className="gc-inspector-condition-input"
                      disabled={runLocked}
                      autoComplete="off"
                      value={httpAuthPassword}
                      onChange={(ev) => {
                        setHttpAuthPassword(ev.target.value);
                      }}
                    />
                  </div>
                </>
              ) : null}
              {httpAuthKind === "bearer" ? (
                <div className="gc-inspector-row gc-inspector-row--field">
                  <label className="gc-inspector-k" htmlFor="gc-inspector-rag-auth-token">
                    {t("app.inspector.httpRequestAuthToken")}
                  </label>
                  <input
                    id="gc-inspector-rag-auth-token"
                    type="password"
                    className="gc-inspector-condition-input"
                    disabled={runLocked}
                    autoComplete="off"
                    value={httpAuthToken}
                    onChange={(ev) => {
                      setHttpAuthToken(ev.target.value);
                    }}
                  />
                </div>
              ) : null}
                </>
              ) : null}
              <button
                type="button"
                className="gc-btn gc-inspector-apply"
                disabled={runLocked}
                onClick={applyRagQueryFields}
              >
                {t("app.inspector.applyRagQuerySettings")}
              </button>
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
            </div>
          ) : null}
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
                <p className="gc-inspector-edge-hint">{t("app.inspector.stepCacheHint")}</p>
              </div>
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
          {selection.graphNodeType === GRAPH_NODE_TYPE_PYTHON_CODE ? (
            <div className="gc-inspector-mcp">
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-py-code">
                  {t("app.inspector.pythonCodeEditorLabel")}
                </label>
                <textarea
                  id="gc-inspector-py-code"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  rows={12}
                  spellCheck={false}
                  value={pyCode}
                  onChange={(ev) => {
                    setPyCode(ev.target.value);
                  }}
                />
                <p className="gc-inspector-edge-hint">{t("app.inspector.pythonCodeEditorHint")}</p>
              </div>
              <div className="gc-inspector-row gc-inspector-row--field">
                <label className="gc-inspector-k" htmlFor="gc-inspector-py-timeout">
                  {t("app.inspector.pythonCodeTimeoutSec")}
                </label>
                <input
                  id="gc-inspector-py-timeout"
                  type="text"
                  inputMode="decimal"
                  className="gc-inspector-condition-input"
                  disabled={runLocked}
                  value={pyTimeoutSec}
                  onChange={(ev) => {
                    setPyTimeoutSec(ev.target.value);
                  }}
                />
              </div>
              <button
                type="button"
                className="gc-btn gc-inspector-apply"
                disabled={runLocked}
                onClick={applyPythonCodeFields}
              >
                {t("app.inspector.applyPythonCodeSettings")}
              </button>
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
          {selection.graphNodeType === GRAPH_NODE_TYPE_AGENT ? (
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
