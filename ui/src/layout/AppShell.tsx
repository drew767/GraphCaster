// Copyright GraphCaster. All Rights Reserved.

import exampleDocument from "@schemas/graph-document.example.json";
import type { Node } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";

import type { GraphCanvasHandle, GraphCanvasSelection } from "../components/GraphCanvas";
import type { AddNodeMenuPick, WorkspaceGraphAddMenuRow } from "../graph/addNodeMenu";
import { GraphCanvas } from "../components/GraphCanvas";
import { NodeSearchPalette } from "../components/NodeSearchPalette";
import { ConsolePanel } from "../components/ConsolePanel";
import { OpenGraphErrorModal } from "../components/OpenGraphErrorModal";
import { GraphSaveModal, type GraphSaveToWorkspaceResult } from "../components/GraphSaveModal";
import { WorkspaceFileConflictModal } from "../components/WorkspaceFileConflictModal";
import { RunHistoryModal } from "../components/RunHistoryModal";
import { InspectorPanel } from "../components/InspectorPanel";
import { KeyboardShortcutsModal } from "../components/KeyboardShortcutsModal";
import { OnboardingTips } from "../components/OnboardingTips";
import { TopBar } from "../components/TopBar";
import { createMinimalGraphDocument } from "../graph/documentFactory";
import {
  clearHistory,
  createEmptyHistory,
  documentJsonSignature,
  redoDocument,
  snapshotBeforeChange,
  undoDocument,
} from "../graph/documentHistory";
import type {
  GraphDocumentJson,
  GraphDocumentSettingsPatch,
  GraphEdgeJson,
  GraphNodeJson,
} from "../graph/types";
import { findBranchAmbiguities } from "../graph/branchWarnings";
import { isGcFlowConnectionAllowed } from "../graph/connectionCompatibility";
import { flowToDocument } from "../graph/fromReactFlow";
import { pickCommentParentId } from "../graph/flowHierarchy";
import {
  alignSelectionPossible,
  applyAlignDistribute,
  distributeSelectionPossible,
  type AlignDistributeOp,
} from "../graph/canvasAlignSelection";
import {
  readGhostOffViewportEnabled,
  writeGhostOffViewportEnabled,
} from "../graph/canvasGhostOffViewport";
import {
  readRunMotionPreference,
  writeRunMotionPreference,
  type RunMotionPreference,
} from "../graph/canvasRunMotion";
import { readEdgeLabelsEnabled, writeEdgeLabelsEnabled } from "../graph/canvasEdgeLabels";
import { readFollowRunPreference, writeFollowRunPreference } from "../graph/canvasFollowRun";
import { readSnapGridEnabled, writeSnapGridEnabled } from "../graph/canvasSnapGrid";
import {
  applyGroupSelection,
  applyUngroupSelection,
  canApplyGroupSelection,
} from "../graph/groupSelection";
import {
  defaultCursorAgentTaskData,
  defaultDataForNodeType,
  newGraphEdgeId,
  newGraphNodeId,
} from "../graph/nodePalette";
import {
  GRAPH_NODE_TYPE_GRAPH_REF,
  GRAPH_NODE_TYPE_GROUP,
  GRAPH_NODE_TYPE_START,
  GRAPH_NODE_TYPE_TASK,
  isGraphDocumentFrameType,
} from "../graph/nodeKinds";
import type { AppMessagePresentation } from "../graph/openGraphErrorPresentation";
import {
  presentationForInspectorSimple,
  presentationForJsonSyntaxError,
  presentationForParseError,
  presentationForReadFailure,
} from "../graph/openGraphErrorPresentation";
import { buildCanvasNodeSearchRows } from "../graph/canvasNodeSearch";
import {
  buildClipboardPayload,
  mergePastedSubgraph,
  parseClipboardPayload,
} from "../graph/clipboard";
import {
  type GraphRefSnapshotLoadResult,
  parseGraphRefSnapshotFromJsonText,
} from "../graph/graphRefLazySnapshot";
import { graphIdFromDocument, parseGraphDocumentJson, parseGraphDocumentJsonResult } from "../graph/parseDocument";
import { findHandleCompatibilityIssues } from "../graph/handleCompatibility";
import { nodeTypeTriggersStepCacheDirtyOnDataEdit } from "../graph/stepCacheDirtyGraph";
import {
  findStructureIssues,
  structureIssuesBlockRun,
  workspaceGraphRefCycleIssues,
} from "../graph/structureWarnings";
import { builtInNodeTemplateById } from "../graph/nodeTemplates";
import {
  branchIssueFocusEdgeId,
  branchIssueFocusNodeId,
  documentWithEdgeConditionCleared,
  handleIssuePrimaryNodeId,
  structureIssueFocusNodeId,
} from "../graph/warningBannerFocus";
import { collectCanvasWarningEdgeIds } from "../graph/warningEdges";
import { flowConnectionHandle } from "../graph/normalizeHandles";
import { isTextEditingTarget } from "../lib/isTextEditingTarget";
import { graphDocumentToFlow, nodeLabel, type GcNodeData } from "../graph/toReactFlow";
import {
  defaultWorkspaceFileName,
  ensureGraphsDirectory,
  findWorkspaceGraphIdConflict,
  getWorkspaceGraphDiskFingerprint,
  pickProjectRootDirectory,
  readWorkspaceGraphFile,
  readWorkspaceGraphFileWithFingerprint,
  sanitizeWorkspaceGraphFileName,
  scanWorkspaceGraphs,
  supportsFileSystemAccess,
  workspaceDiskFingerprintConflicts,
  writeJsonFileToDir,
  type WorkspaceGraphEntry,
} from "../lib/workspaceFs";
import { useConsoleHeight } from "../hooks/useConsoleHeight";
import { NodePaletteSidebar } from "../components/NodePaletteSidebar";
import {
  gcCancelRun,
  getRunEnvironmentInfo,
  launchGcStartJob,
} from "../run/runCommands";
import type { GcStartRunJob } from "../run/runSessionStore";
import {
  getRunSessionSnapshot,
  runSessionAppendLine,
  runSessionCanStartAnotherLive,
  runSessionClearReplay,
  runSessionClearSettledVisualForCurrentGraph,
  runSessionEnqueuePending,
  runSessionHasBlockingActivity,
  runSessionSetCurrentRootGraphId,
  runSessionSetFocusedRunId,
  runSessionSetPythonBanner,
  useRunSession,
} from "../run/runSessionStore";
import {
  markStepCacheDirtyWithNestedBubble,
  type NestedGraphRefFrame,
} from "../run/nestedStepCacheDirtyBubble";
import {
  clearStepCacheDirtyIds,
  getStepCacheDirtySnapshot,
  useStepCacheDirtyCount,
} from "../run/stepCacheDirtyStore";
import { isTauriRuntime } from "../run/tauriEnv";
import { useRunBridge } from "../run/useRunBridge";
import { useToast } from "../toast/ToastProvider";

const LS_RUN_GRAPHS = "gc.run.graphsDir";
const LS_RUN_ARTIFACTS = "gc.run.artifactsBase";
const LS_RUN_STEP_CACHE = "gc.run.stepCacheEnabled";

const DOCUMENT_HISTORY_CAP = 80;

function formatGraphRefCycleForUi(cycle: string[]): string {
  if (cycle.length === 0) {
    return "";
  }
  if (cycle.length === 1) {
    return `${cycle[0]} → ${cycle[0]}`;
  }
  return `${cycle.join(" → ")} → ${cycle[0]}`;
}

function mergeNewNodeAndConnectEdge(
  doc: GraphDocumentJson,
  nextNodes: GraphNodeJson[],
  newNodeId: string,
  connectFrom?: { sourceNodeId: string; sourceHandle: string },
): GraphDocumentJson {
  const base: GraphDocumentJson = { ...doc, nodes: nextNodes };
  if (!connectFrom) {
    return base;
  }
  const { nodes: flowNodes, edges: flowEdges } = graphDocumentToFlow(base);
  const sh = flowConnectionHandle(connectFrom.sourceHandle, "out_default");
  if (
    !isGcFlowConnectionAllowed(
      {
        source: connectFrom.sourceNodeId,
        target: newNodeId,
        sourceHandle: sh,
        targetHandle: "in_default",
      },
      flowNodes,
      flowEdges,
    )
  ) {
    return base;
  }
  const edge: GraphEdgeJson = {
    id: newGraphEdgeId(),
    source: connectFrom.sourceNodeId,
    target: newNodeId,
    sourceHandle: sh,
    targetHandle: "in_default",
    condition: null,
  };
  return { ...base, edges: [...(doc.edges ?? []), edge] };
}

type Props = {
  onLangChange: (lng: string) => void;
};

export function AppShell({ onLangChange }: Props) {
  const { t } = useTranslation();
  const { push: pushToast } = useToast();
  useRunBridge();
  const runSession = useRunSession();
  const runSessionBlocking =
    runSession.liveRunIds.length > 0 || runSession.pendingRunCount > 0;
  const hasLiveGraphRun = runSession.liveRunIds.length > 0;
  const { height, startDrag } = useConsoleHeight(168);
  const [selection, setSelection] = useState<GraphCanvasSelection | null>(null);
  const [graphDocument, setGraphDocument] = useState<GraphDocumentJson>(() => {
    const parsed = parseGraphDocumentJson(exampleDocument as unknown);
    return parsed ?? createMinimalGraphDocument();
  });
  const nodeSearchRows = useMemo(() => buildCanvasNodeSearchRows(graphDocument), [graphDocument]);
  const branchIssues = useMemo(() => findBranchAmbiguities(graphDocument), [graphDocument]);
  const resolvedGraphId = useMemo(() => graphIdFromDocument(graphDocument) ?? "", [graphDocument]);

  useEffect(() => {
    runSessionSetCurrentRootGraphId(
      resolvedGraphId.trim() !== "" ? resolvedGraphId.trim() : null,
    );
  }, [resolvedGraphId]);

  const handleIssues = useMemo(() => findHandleCompatibilityIssues(graphDocument), [graphDocument]);
  const [danglingEdgesExportIds, setDanglingEdgesExportIds] = useState<string[] | null>(null);

  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const [workspaceGraphsDir, setWorkspaceGraphsDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [workspaceIndex, setWorkspaceIndex] = useState<WorkspaceGraphEntry[]>([]);
  const structureIssues = useMemo(() => {
    const base = findStructureIssues(graphDocument);
    if (workspaceGraphsDir == null || workspaceIndex.length === 0) {
      return base;
    }
    return [...base, ...workspaceGraphRefCycleIssues(workspaceIndex)];
  }, [graphDocument, workspaceGraphsDir, workspaceIndex]);
  const canvasWarningEdgeIds = useMemo(
    () => collectCanvasWarningEdgeIds(graphDocument, structureIssues),
    [graphDocument, structureIssues],
  );
  const [activeWorkspaceFile, setActiveWorkspaceFile] = useState<string | null>(null);
  const workspaceDiskBaselineRef = useRef<{
    fileName: string;
    lastModifiedMs: number;
    sizeBytes: number;
  } | null>(null);
  const forceOverwriteDiskConflictRef = useRef(false);
  const [workspaceAutosaveConflictOpen, setWorkspaceAutosaveConflictOpen] = useState(false);
  const [autosaveDiskConflictPaused, setAutosaveDiskConflictPaused] = useState(false);
  const [layoutDirtyEpoch, setLayoutDirtyEpoch] = useState(0);
  const canvasRef = useRef<GraphCanvasHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveModalSuggestedName, setSaveModalSuggestedName] = useState("graph.json");
  const [appMessageModal, setAppMessageModal] = useState<AppMessagePresentation | null>(null);
  const [nodeSearchOpen, setNodeSearchOpen] = useState(false);
  const [keyboardShortcutsOpen, setKeyboardShortcutsOpen] = useState(false);
  const [runHistoryOpen, setRunHistoryOpen] = useState(false);
  const [nodePaletteSidebarOpen, setNodePaletteSidebarOpen] = useState(true);
  const hasStartNode = useMemo(
    () => (graphDocument.nodes ?? []).some((n) => n.type === "start"),
    [graphDocument],
  );
  const [autosaveFailed, setAutosaveFailed] = useState(false);
  const lastAutosaveFailConsoleMsRef = useRef(0);
  const [runGraphsDir, setRunGraphsDir] = useState(() => localStorage.getItem(LS_RUN_GRAPHS) ?? "");
  const [runArtifactsBase, setRunArtifactsBase] = useState(
    () => localStorage.getItem(LS_RUN_ARTIFACTS) ?? "",
  );
  const [stepCacheRunEnabled, setStepCacheRunEnabled] = useState(
    () => localStorage.getItem(LS_RUN_STEP_CACHE) === "1",
  );
  const [snapToGridEnabled, setSnapToGridEnabled] = useState(() => readSnapGridEnabled());
  const [edgeLabelsEnabled, setEdgeLabelsEnabled] = useState(() => readEdgeLabelsEnabled());
  const [ghostOffViewportEnabled, setGhostOffViewportEnabled] = useState(() =>
    readGhostOffViewportEnabled(),
  );
  const [runMotionPreference, setRunMotionPreference] = useState<RunMotionPreference>(() =>
    readRunMotionPreference(),
  );
  const [followRunEnabled, setFollowRunEnabled] = useState(() => readFollowRunPreference());
  const stepCacheDirtyCount = useStepCacheDirtyCount();
  const [pyProbe, setPyProbe] = useState<{ ok: boolean; path: string } | null>(null);
  const historyRef = useRef(createEmptyHistory(DOCUMENT_HISTORY_CAP));
  const preDragDocumentRef = useRef<GraphDocumentJson | null>(null);
  const graphDocumentRef = useRef(graphDocument);
  graphDocumentRef.current = graphDocument;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const nodeSearchOpenRef = useRef(nodeSearchOpen);
  nodeSearchOpenRef.current = nodeSearchOpen;
  const nestedGraphRefStackRef = useRef<NestedGraphRefFrame[]>([]);
  const graphRefSnapshotCacheRef = useRef(new Map<string, GraphRefSnapshotLoadResult>());
  const graphRefSnapshotInflightRef = useRef(
    new Map<string, Promise<GraphRefSnapshotLoadResult>>(),
  );
  const stepCacheDirtyBubbleChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const [historyTick, setHistoryTick] = useState(0);

  const bumpHistoryUi = useCallback(() => {
    setHistoryTick((n) => n + 1);
  }, []);

  const commitHistorySnapshot = useCallback(() => {
    preDragDocumentRef.current = null;
    if (runSessionHasBlockingActivity()) {
      return;
    }
    const current =
      canvasRef.current?.exportDocument({ notifyRemovedDanglingEdges: false }) ??
      graphDocumentRef.current;
    historyRef.current = snapshotBeforeChange(historyRef.current, current);
    bumpHistoryUi();
  }, [bumpHistoryUi]);

  const beginNodeDragCapture = useCallback(() => {
    if (runSessionHasBlockingActivity()) {
      return;
    }
    const api = canvasRef.current;
    if (!api) {
      return;
    }
    preDragDocumentRef.current = structuredClone(
      api.exportDocument({ notifyRemovedDanglingEdges: false }),
    ) as GraphDocumentJson;
  }, []);

  const commitNodeDragHistoryIfChanged = useCallback(() => {
    if (runSessionHasBlockingActivity()) {
      preDragDocumentRef.current = null;
      return;
    }
    const pre = preDragDocumentRef.current;
    preDragDocumentRef.current = null;
    if (pre == null) {
      return;
    }
    const api = canvasRef.current;
    if (!api) {
      return;
    }
    const after = api.exportDocument({ notifyRemovedDanglingEdges: false });
    if (documentJsonSignature(pre) === documentJsonSignature(after)) {
      return;
    }
    historyRef.current = snapshotBeforeChange(historyRef.current, pre);
    bumpHistoryUi();
  }, [bumpHistoryUi]);

  const performUndo = useCallback(() => {
    preDragDocumentRef.current = null;
    if (runSessionHasBlockingActivity()) {
      return;
    }
    const current =
      canvasRef.current?.exportDocument({ notifyRemovedDanglingEdges: false }) ??
      graphDocumentRef.current;
    const r = undoDocument(historyRef.current, current);
    if (!r) {
      return;
    }
    historyRef.current = r.nextHistory;
    setDanglingEdgesExportIds(null);
    setGraphDocument(r.document);
    setLayoutDirtyEpoch((n) => n + 1);
    bumpHistoryUi();
  }, [bumpHistoryUi]);

  const performRedo = useCallback(() => {
    preDragDocumentRef.current = null;
    if (runSessionHasBlockingActivity()) {
      return;
    }
    const current =
      canvasRef.current?.exportDocument({ notifyRemovedDanglingEdges: false }) ??
      graphDocumentRef.current;
    const r = redoDocument(historyRef.current, current);
    if (!r) {
      return;
    }
    historyRef.current = r.nextHistory;
    setDanglingEdgesExportIds(null);
    setGraphDocument(r.document);
    setLayoutDirtyEpoch((n) => n + 1);
    bumpHistoryUi();
  }, [bumpHistoryUi]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (runSessionHasBlockingActivity()) {
        return;
      }
      if (isTextEditingTarget(e.target)) {
        return;
      }
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) {
        return;
      }
      if (key === "z") {
        if (e.shiftKey) {
          e.preventDefault();
          performRedo();
        } else {
          e.preventDefault();
          performUndo();
        }
        return;
      }
      if (key === "y") {
        e.preventDefault();
        performRedo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [performRedo, performUndo]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (nodeSearchOpen) {
        return;
      }
      if (isTextEditingTarget(e.target)) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "f" || k === "k") {
        e.preventDefault();
        setNodeSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [nodeSearchOpen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextEditingTarget(e.target)) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || !e.shiftKey) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        setNodePaletteSidebarOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "F1") {
        return;
      }
      if (isTextEditingTarget(e.target)) {
        return;
      }
      e.preventDefault();
      setKeyboardShortcutsOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(LS_RUN_GRAPHS, runGraphsDir);
  }, [runGraphsDir]);
  useEffect(() => {
    localStorage.setItem(LS_RUN_ARTIFACTS, runArtifactsBase);
  }, [runArtifactsBase]);
  useEffect(() => {
    if (runArtifactsBase.trim() === "") {
      setStepCacheRunEnabled(false);
    }
  }, [runArtifactsBase]);
  useEffect(() => {
    localStorage.setItem(LS_RUN_STEP_CACHE, stepCacheRunEnabled ? "1" : "0");
  }, [stepCacheRunEnabled]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      void getRunEnvironmentInfo().then((info) => {
        setPyProbe({ ok: info.moduleAvailable, path: info.pythonPath });
        runSessionSetPythonBanner(
          info.moduleAvailable ? null : t("app.run.brokerMissing", { path: info.pythonPath }),
        );
      });
      return;
    }
    void getRunEnvironmentInfo().then((info) => {
      setPyProbe({ ok: info.moduleAvailable, path: info.pythonPath });
      runSessionSetPythonBanner(
        info.moduleAvailable ? null : t("app.run.pythonMissing", { path: info.pythonPath }),
      );
    });
  }, [t]);

  const bumpLayoutEpoch = useCallback(() => {
    setLayoutEpoch((n) => n + 1);
  }, []);

  const rescanWorkspace = useCallback(async (dir: FileSystemDirectoryHandle) => {
    graphRefSnapshotCacheRef.current.clear();
    graphRefSnapshotInflightRef.current.clear();
    try {
      setWorkspaceIndex(await scanWorkspaceGraphs(dir));
    } catch {
      setWorkspaceIndex([]);
    }
  }, []);

  const invalidateGraphRefSnapshotCacheForGraphId = useCallback((gid: string | null | undefined) => {
    const t = (gid ?? "").trim();
    if (t === "") {
      return;
    }
    graphRefSnapshotCacheRef.current.delete(t);
    graphRefSnapshotInflightRef.current.delete(t);
  }, []);

  const onNewGraph = useCallback(() => {
    nestedGraphRefStackRef.current = [];
    preDragDocumentRef.current = null;
    setDanglingEdgesExportIds(null);
    setGraphDocument(createMinimalGraphDocument());
    historyRef.current = clearHistory(historyRef.current);
    bumpHistoryUi();
    workspaceDiskBaselineRef.current = null;
    setActiveWorkspaceFile(null);
    setWorkspaceAutosaveConflictOpen(false);
    setAutosaveDiskConflictPaused(false);
    bumpLayoutEpoch();
    setSelection(null);
  }, [bumpHistoryUi, bumpLayoutEpoch]);

  const onOpenPick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) {
        return;
      }
      let text: string;
      try {
        text = await file.text();
      } catch {
        setAppMessageModal(presentationForReadFailure(t, { fileName: file.name }));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        setAppMessageModal(presentationForJsonSyntaxError(t, err, { fileName: file.name }));
        return;
      }
      const res = parseGraphDocumentJsonResult(parsed);
      if (!res.ok) {
        setAppMessageModal(presentationForParseError(t, res.error, { fileName: file.name }));
        return;
      }
      nestedGraphRefStackRef.current = [];
      workspaceDiskBaselineRef.current = null;
      setActiveWorkspaceFile(null);
      setWorkspaceAutosaveConflictOpen(false);
      setAutosaveDiskConflictPaused(false);
      preDragDocumentRef.current = null;
      setDanglingEdgesExportIds(null);
      setGraphDocument(res.doc);
      historyRef.current = clearHistory(historyRef.current);
      bumpHistoryUi();
      bumpLayoutEpoch();
      setSelection(null);
    },
    [bumpHistoryUi, bumpLayoutEpoch, t],
  );

  const onLinkWorkspace = useCallback(async () => {
    if (!supportsFileSystemAccess()) {
      window.alert(t("app.workspace.notSupported"));
      return;
    }
    const root = await pickProjectRootDirectory();
    if (!root) {
      return;
    }
    try {
      const graphs = await ensureGraphsDirectory(root);
      setWorkspaceGraphsDir(graphs);
      workspaceDiskBaselineRef.current = null;
      setActiveWorkspaceFile(null);
      setWorkspaceAutosaveConflictOpen(false);
      setAutosaveDiskConflictPaused(false);
      await rescanWorkspace(graphs);
    } catch {
      window.alert(t("app.workspace.linkFailed"));
    }
  }, [rescanWorkspace, t]);

  const onOpenWorkspaceGraph = useCallback(
    async (
      fileName: string,
      options?: { keepNestedStack?: boolean; nestedFrameToAppend?: NestedGraphRefFrame },
    ): Promise<boolean> => {
      if (!workspaceGraphsDir) {
        return false;
      }
      if (!options?.keepNestedStack) {
        nestedGraphRefStackRef.current = [];
      }
      let text: string;
      let openFingerprint: { lastModifiedMs: number; sizeBytes: number };
      try {
        const snap = await readWorkspaceGraphFileWithFingerprint(workspaceGraphsDir, fileName);
        text = snap.text;
        openFingerprint = snap.fingerprint;
      } catch {
        setAppMessageModal(presentationForReadFailure(t, { fileName }));
        return false;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        setAppMessageModal(presentationForJsonSyntaxError(t, err, { fileName }));
        return false;
      }
      const res = parseGraphDocumentJsonResult(parsed);
      if (!res.ok) {
        setAppMessageModal(presentationForParseError(t, res.error, { fileName }));
        return false;
      }
      preDragDocumentRef.current = null;
      setDanglingEdgesExportIds(null);
      setGraphDocument(res.doc);
      historyRef.current = clearHistory(historyRef.current);
      bumpHistoryUi();
      setActiveWorkspaceFile(fileName);
      workspaceDiskBaselineRef.current = {
        fileName,
        lastModifiedMs: openFingerprint.lastModifiedMs,
        sizeBytes: openFingerprint.sizeBytes,
      };
      setWorkspaceAutosaveConflictOpen(false);
      setAutosaveDiskConflictPaused(false);
      bumpLayoutEpoch();
      setSelection(null);
      const frame = options?.nestedFrameToAppend;
      if (frame != null && frame.graphRefNodeId.trim() !== "" && frame.parentWorkspaceFileName !== "") {
        nestedGraphRefStackRef.current = [...nestedGraphRefStackRef.current, frame];
      }
      return true;
    },
    [bumpHistoryUi, bumpLayoutEpoch, workspaceGraphsDir, t],
  );

  const readParentGraphDocument = useCallback(
    async (name: string): Promise<GraphDocumentJson | null> => {
      if (!workspaceGraphsDir) {
        return null;
      }
      try {
        const text = await readWorkspaceGraphFile(workspaceGraphsDir, name);
        const parsed: unknown = JSON.parse(text);
        const res = parseGraphDocumentJsonResult(parsed);
        return res.ok ? res.doc : null;
      } catch {
        return null;
      }
    },
    [workspaceGraphsDir],
  );

  const markStepCacheDirtyWithBubble = useCallback(
    (doc: GraphDocumentJson, seeds: readonly string[]) => {
      const stackSnap = [...nestedGraphRefStackRef.current];
      stepCacheDirtyBubbleChainRef.current = stepCacheDirtyBubbleChainRef.current
        .then(() => markStepCacheDirtyWithNestedBubble(doc, seeds, stackSnap, readParentGraphDocument))
        .catch(() => {});
    },
    [readParentGraphDocument],
  );

  const workspaceGraphRows = useMemo((): WorkspaceGraphAddMenuRow[] => {
    return workspaceIndex.map((e) => ({
      fileName: e.fileName,
      graphId: e.graphId,
      label: e.duplicateGraphId
        ? `${e.fileName} ⚠ ${e.graphId}`
        : e.title
          ? `${e.fileName} — ${e.title}`
          : e.fileName,
    }));
  }, [workspaceIndex]);

  const workspaceGraphOptions = useMemo(
    () => workspaceGraphRows.map(({ fileName, label }) => ({ fileName, label })),
    [workspaceGraphRows],
  );

  const loadGraphRefSnapshot = useCallback(
    async (targetGraphId: string, options?: { force?: boolean }): Promise<GraphRefSnapshotLoadResult> => {
      const tid = targetGraphId.trim();
      if (tid === "") {
        return { ok: false, errorKind: "unknown_graph" };
      }
      if (!workspaceGraphsDir) {
        return { ok: false, errorKind: "no_workspace" };
      }
      const entry = workspaceIndex.find((e) => e.graphId === tid);
      if (!entry) {
        return { ok: false, errorKind: "unknown_graph" };
      }

      if (options?.force) {
        graphRefSnapshotCacheRef.current.delete(tid);
        graphRefSnapshotInflightRef.current.delete(tid);
      } else {
        const cached = graphRefSnapshotCacheRef.current.get(tid);
        if (cached) {
          return cached;
        }
        const inflight = graphRefSnapshotInflightRef.current.get(tid);
        if (inflight) {
          return inflight;
        }
      }

      const promise = (async (): Promise<GraphRefSnapshotLoadResult> => {
        let text: string;
        try {
          text = await readWorkspaceGraphFile(workspaceGraphsDir, entry.fileName);
        } catch {
          const err: GraphRefSnapshotLoadResult = { ok: false, errorKind: "read" };
          graphRefSnapshotCacheRef.current.set(tid, err);
          return err;
        }
        const parsed = parseGraphRefSnapshotFromJsonText(text);
        const result: GraphRefSnapshotLoadResult = parsed.ok
          ? { ok: true, snapshot: parsed.snapshot }
          : { ok: false, errorKind: parsed.errorKind };
        graphRefSnapshotCacheRef.current.set(tid, result);
        return result;
      })();

      graphRefSnapshotInflightRef.current.set(tid, promise);
      try {
        return await promise;
      } finally {
        graphRefSnapshotInflightRef.current.delete(tid);
      }
    },
    [workspaceGraphsDir, workspaceIndex],
  );

  const getGraphRefWorkspaceHint = useCallback(
    (targetGraphId: string): { title?: string; fileName: string; duplicateGraphId: boolean } | null => {
      const tid = targetGraphId.trim();
      if (tid === "") {
        return null;
      }
      const entry = workspaceIndex.find((e) => e.graphId === tid);
      if (!entry) {
        return null;
      }
      return {
        title: entry.title,
        fileName: entry.fileName,
        duplicateGraphId: entry.duplicateGraphId,
      };
    },
    [workspaceIndex],
  );

  const onConsoleNavigateToNode = useCallback(
    (nodeId: string) => {
      const id = nodeId.trim();
      if (id === "") {
        return;
      }
      const node = graphDocument.nodes?.find((n) => n.id === id);
      if (!node) {
        return;
      }
      const raw = node.data ?? {};
      setSelection({
        kind: "node",
        id: node.id,
        graphNodeType: node.type,
        label: nodeLabel(raw, node.id),
        raw,
      });
      requestAnimationFrame(() => {
        canvasRef.current?.focusNode(id);
      });
    },
    [graphDocument],
  );

  const onWarningFocusEdge = useCallback(
    (edgeId: string) => {
      const id = edgeId.trim();
      if (id === "") {
        return;
      }
      const e = graphDocument.edges?.find((x) => x.id === id);
      if (!e) {
        return;
      }
      const d = e.data;
      const rd = typeof d?.routeDescription === "string" ? d.routeDescription : "";
      setSelection({
        kind: "edge",
        id: e.id,
        source: e.source,
        target: e.target,
        condition: e.condition ?? null,
        routeDescription: rd,
      });
      requestAnimationFrame(() => {
        canvasRef.current?.focusEdge(id);
      });
    },
    [graphDocument],
  );

  const onQuickClearEdgeCondition = useCallback(
    (edgeId: string) => {
      if (runSessionBlocking) {
        return;
      }
      commitHistorySnapshot();
      setGraphDocument((prev) => documentWithEdgeConditionCleared(prev, edgeId));
    },
    [commitHistorySnapshot, runSessionBlocking],
  );

  const markDiskConflictOverwrite = useCallback(() => {
    forceOverwriteDiskConflictRef.current = true;
  }, []);

  const saveDocumentToWorkspace = useCallback(
    async (doc: GraphDocumentJson, targetFileName: string): Promise<GraphSaveToWorkspaceResult> => {
      if (!workspaceGraphsDir) {
        return { ok: false, reason: "no_workspace" };
      }
      const gid = graphIdFromDocument(doc) ?? "";
      const safeTarget = sanitizeWorkspaceGraphFileName(targetFileName);
      const conflict = findWorkspaceGraphIdConflict(workspaceIndex, gid, safeTarget);
      if (conflict) {
        return { ok: false, reason: "duplicate_graph_id", conflictingFile: conflict };
      }
      const baseline = workspaceDiskBaselineRef.current;
      const forceOverwrite = forceOverwriteDiskConflictRef.current;
      if (
        !forceOverwrite &&
        baseline != null &&
        baseline.fileName === safeTarget &&
        safeTarget === activeWorkspaceFile
      ) {
        const cur = await getWorkspaceGraphDiskFingerprint(workspaceGraphsDir, safeTarget);
        if (
          cur != null &&
          workspaceDiskFingerprintConflicts(
            { lastModifiedMs: baseline.lastModifiedMs, sizeBytes: baseline.sizeBytes },
            cur,
          )
        ) {
          return { ok: false, reason: "file_changed_on_disk" };
        }
      }
      try {
        await writeJsonFileToDir(workspaceGraphsDir, safeTarget, doc);
        forceOverwriteDiskConflictRef.current = false;
        const fpAfter = await getWorkspaceGraphDiskFingerprint(workspaceGraphsDir, safeTarget);
        if (fpAfter) {
          workspaceDiskBaselineRef.current = {
            fileName: safeTarget,
            lastModifiedMs: fpAfter.lastModifiedMs,
            sizeBytes: fpAfter.sizeBytes,
          };
        } else {
          workspaceDiskBaselineRef.current = null;
        }
        setAutosaveDiskConflictPaused(false);
        setWorkspaceAutosaveConflictOpen(false);
        setGraphDocument(doc);
        setActiveWorkspaceFile(safeTarget);
        setAutosaveFailed(false);
        await rescanWorkspace(workspaceGraphsDir);
        return { ok: true };
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        const d = raw.trim();
        return { ok: false, reason: "write_failed", detail: d === "" ? null : d };
      }
    },
    [activeWorkspaceFile, rescanWorkspace, workspaceGraphsDir, workspaceIndex],
  );

  const onAutosaveDiskConflictReload = useCallback(() => {
    setWorkspaceAutosaveConflictOpen(false);
    setAutosaveDiskConflictPaused(false);
    const fn = activeWorkspaceFile;
    if (fn) {
      void onOpenWorkspaceGraph(fn);
    }
  }, [activeWorkspaceFile, onOpenWorkspaceGraph]);

  const onAutosaveDiskConflictOverwrite = useCallback(async () => {
    if (!workspaceGraphsDir || !activeWorkspaceFile) {
      return;
    }
    setWorkspaceAutosaveConflictOpen(false);
    setAutosaveDiskConflictPaused(false);
    forceOverwriteDiskConflictRef.current = true;
    const api = canvasRef.current;
    if (!api) {
      return;
    }
    const doc = api.exportDocument({ notifyRemovedDanglingEdges: false });
    const gidConflict = findWorkspaceGraphIdConflict(
      workspaceIndex,
      graphIdFromDocument(doc) ?? "",
      activeWorkspaceFile,
    );
    if (gidConflict) {
      forceOverwriteDiskConflictRef.current = false;
      return;
    }
    try {
      await writeJsonFileToDir(workspaceGraphsDir, activeWorkspaceFile, doc);
      forceOverwriteDiskConflictRef.current = false;
      const fpAfter = await getWorkspaceGraphDiskFingerprint(workspaceGraphsDir, activeWorkspaceFile);
      if (fpAfter) {
        workspaceDiskBaselineRef.current = {
          fileName: activeWorkspaceFile,
          lastModifiedMs: fpAfter.lastModifiedMs,
          sizeBytes: fpAfter.sizeBytes,
        };
      }
      invalidateGraphRefSnapshotCacheForGraphId(graphIdFromDocument(doc));
      setGraphDocument(doc);
      setAutosaveFailed(false);
    } catch {
      setAutosaveFailed(true);
      const now = Date.now();
      if (now - lastAutosaveFailConsoleMsRef.current >= 30_000) {
        lastAutosaveFailConsoleMsRef.current = now;
        runSessionAppendLine(t("app.editor.autosaveFailedConsole"));
      }
    }
  }, [
    activeWorkspaceFile,
    invalidateGraphRefSnapshotCacheForGraphId,
    t,
    workspaceGraphsDir,
    workspaceIndex,
  ]);

  const onAutosaveDiskConflictPause = useCallback(() => {
    setWorkspaceAutosaveConflictOpen(false);
    setAutosaveDiskConflictPaused(true);
    pushToast(t("app.workspace.diskConflictPausedToast"), "info");
  }, [pushToast, t]);

  const openSaveModal = useCallback(() => {
    if (runSessionHasBlockingActivity()) {
      window.alert(t("app.run.cannotSaveDuringRun"));
      return;
    }
    const api = canvasRef.current;
    if (!api) {
      return;
    }
    const doc = api.exportDocument();
    setSaveModalSuggestedName(activeWorkspaceFile ?? defaultWorkspaceFileName(doc));
    setSaveModalOpen(true);
  }, [activeWorkspaceFile, t]);

  const onSaveGraph = useCallback(() => {
    openSaveModal();
  }, [openSaveModal]);

  const startDesktopRun = useCallback(
    async (untilNodeId?: string) => {
      if (structureIssuesBlockRun(structureIssues)) {
        window.alert(t("app.run.fixStructureFirst"));
        return;
      }
      if (pyProbe != null && !pyProbe.ok) {
        window.alert(
          isTauriRuntime()
            ? t("app.run.pythonMissing", { path: pyProbe.path })
            : t("app.run.brokerMissing", { path: pyProbe.path }),
        );
        return;
      }
      const api = canvasRef.current;
      if (!api) {
        return;
      }
      const doc = api.exportDocument();
      const runId = crypto.randomUUID();
      const art = runArtifactsBase.trim();
      const dirtyCsv = getStepCacheDirtySnapshot().ids.join(",");
      const useStepCache = stepCacheRunEnabled && art !== "";
      const job: GcStartRunJob = {
        documentJson: JSON.stringify(doc),
        runId,
        graphsDir: runGraphsDir.trim() || undefined,
        artifactsBase: art === "" ? undefined : art,
        untilNodeId: untilNodeId?.trim() || undefined,
        stepCache: useStepCache ? true : undefined,
        stepCacheDirty: useStepCache && dirtyCsv !== "" ? dirtyCsv : undefined,
      };
      runSessionClearReplay();
      if (!runSessionCanStartAnotherLive()) {
        runSessionEnqueuePending(job);
        const pos = getRunSessionSnapshot().pendingRunCount;
        runSessionAppendLine(
          t("app.run.queuedHost", { runId, position: pos }),
        );
        pushToast(t("app.toast.runQueued"), "info");
        return;
      }
      try {
        await launchGcStartJob(job, {
          afterSuccessfulStart: () => {
            if (useStepCache && dirtyCsv !== "") {
              clearStepCacheDirtyIds();
            }
          },
        });
        pushToast(t("app.toast.runStarted"), "success");
      } catch {
        /* host lines emitted in launchGcStartJob */
      }
    },
    [
      pyProbe,
      pushToast,
      runArtifactsBase,
      runGraphsDir,
      stepCacheRunEnabled,
      structureIssues,
      t,
    ],
  );

  const onRunGraph = useCallback(() => {
    void startDesktopRun(undefined);
  }, [startDesktopRun]);

  const onRunUntilSelectedNode = useCallback(() => {
    const sel = selectionRef.current;
    if (sel?.kind === "node") {
      if (sel.graphNodeType === "start") {
        return;
      }
      void startDesktopRun(sel.id);
      return;
    }
    if (sel?.kind === "multiNode" && sel.ids.length === 1) {
      const row = sel.nodes[0];
      if (row == null || row.graphNodeType === "start") {
        return;
      }
      void startDesktopRun(row.id);
    }
  }, [startDesktopRun]);

  const runUntilSelectionEnabled = useMemo(() => {
    if (runSessionBlocking) {
      return false;
    }
    if (pyProbe != null && !pyProbe.ok) {
      return false;
    }
    if (selection?.kind === "node") {
      return selection.graphNodeType !== "start";
    }
    if (selection?.kind === "multiNode" && selection.ids.length === 1) {
      return selection.nodes[0]?.graphNodeType !== "start";
    }
    return false;
  }, [runSessionBlocking, pyProbe, selection]);

  const onStopRunGraph = useCallback(async () => {
    const id = getRunSessionSnapshot().focusedRunId;
    if (!id) {
      return;
    }
    try {
      await gcCancelRun(id);
    } catch (e) {
      runSessionAppendLine(`[host] cancel: ${String(e)}`);
    }
  }, []);

  useEffect(() => {
    if (!workspaceGraphsDir || !activeWorkspaceFile) {
      return;
    }
    if (runSessionBlocking) {
      return;
    }
    if (autosaveDiskConflictPaused) {
      return;
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        if (runSessionHasBlockingActivity()) {
          return;
        }
        const api = canvasRef.current;
        if (!api || !workspaceGraphsDir) {
          return;
        }
        const doc = api.exportDocument({ notifyRemovedDanglingEdges: false });
        const conflict = findWorkspaceGraphIdConflict(
          workspaceIndex,
          graphIdFromDocument(doc) ?? "",
          activeWorkspaceFile,
        );
        if (conflict) {
          return;
        }
        const baseline = workspaceDiskBaselineRef.current;
        if (baseline != null && baseline.fileName === activeWorkspaceFile) {
          const cur = await getWorkspaceGraphDiskFingerprint(workspaceGraphsDir, activeWorkspaceFile);
          if (
            cur != null &&
            workspaceDiskFingerprintConflicts(
              { lastModifiedMs: baseline.lastModifiedMs, sizeBytes: baseline.sizeBytes },
              cur,
            )
          ) {
            setWorkspaceAutosaveConflictOpen(true);
            return;
          }
        }
        try {
          await writeJsonFileToDir(workspaceGraphsDir, activeWorkspaceFile, doc);
          const fpAfter = await getWorkspaceGraphDiskFingerprint(workspaceGraphsDir, activeWorkspaceFile);
          if (fpAfter) {
            workspaceDiskBaselineRef.current = {
              fileName: activeWorkspaceFile,
              lastModifiedMs: fpAfter.lastModifiedMs,
              sizeBytes: fpAfter.sizeBytes,
            };
          }
          invalidateGraphRefSnapshotCacheForGraphId(graphIdFromDocument(doc));
          setGraphDocument(doc);
          setAutosaveFailed(false);
        } catch {
          setAutosaveFailed(true);
          const now = Date.now();
          if (now - lastAutosaveFailConsoleMsRef.current >= 30_000) {
            lastAutosaveFailConsoleMsRef.current = now;
            runSessionAppendLine(t("app.editor.autosaveFailedConsole"));
          }
        }
      })();
    }, 2000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    activeWorkspaceFile,
    autosaveDiskConflictPaused,
    graphDocument,
    invalidateGraphRefSnapshotCacheForGraphId,
    layoutDirtyEpoch,
    workspaceGraphsDir,
    workspaceIndex,
    runSessionBlocking,
    t,
  ]);

  const getDocumentForStepCacheDirty = useCallback((): GraphDocumentJson => {
    const api = canvasRef.current;
    if (api) {
      return api.exportDocument();
    }
    return graphDocument;
  }, [graphDocument]);

  const onApplyNodeData = useCallback((nodeId: string, data: Record<string, unknown>) => {
    const api = canvasRef.current;
    if (!api) {
      return;
    }
    commitHistorySnapshot();
    const doc = api.exportDocument();
    const prevNodes = doc.nodes ?? [];
    const nodes = prevNodes.map((n) => (n.id === nodeId ? { ...n, data: { ...data } } : n));
    const nextDoc = { ...doc, nodes };
    setGraphDocument(nextDoc);
    const prevType = prevNodes.find((n) => n.id === nodeId)?.type;
    if (nodeTypeTriggersStepCacheDirtyOnDataEdit(prevType)) {
      markStepCacheDirtyWithBubble(nextDoc, [nodeId]);
    }
    setSelection((prev) => {
      if (!prev || prev.kind !== "node" || prev.id !== nodeId) {
        return prev;
      }
      return {
        ...prev,
        raw: { ...data },
        label: nodeLabel(data, nodeId),
      };
    });
  }, [commitHistorySnapshot, markStepCacheDirtyWithBubble]);

  const onApplyEdgeCondition = useCallback((edgeId: string, condition: string | null) => {
    const api = canvasRef.current;
    if (!api) {
      return;
    }
    commitHistorySnapshot();
    const doc = api.exportDocument();
    const prevEdges = doc.edges ?? [];
    const edges = prevEdges.map((e) => (e.id === edgeId ? { ...e, condition } : e));
    const nextDoc = { ...doc, edges };
    setGraphDocument(nextDoc);
    const src = prevEdges.find((e) => e.id === edgeId)?.source;
    if (src != null && src !== "") {
      markStepCacheDirtyWithBubble(nextDoc, [src]);
    }
    setSelection((prev) => {
      if (!prev || prev.kind !== "edge" || prev.id !== edgeId) {
        return prev;
      }
      return { ...prev, condition };
    });
  }, [commitHistorySnapshot, markStepCacheDirtyWithBubble]);

  const onApplyEdgeData = useCallback(
    (edgeId: string, patch: { routeDescription: string }) => {
      const api = canvasRef.current;
      if (!api) {
        return;
      }
      commitHistorySnapshot();
      const doc = api.exportDocument();
      const edges = (doc.edges ?? []).map((e) => {
        if (e.id !== edgeId) {
          return e;
        }
        const t = patch.routeDescription.trim();
        const next = { ...e };
        if (t === "") {
          delete next.data;
        } else {
          next.data = { routeDescription: t.slice(0, 1024) };
        }
        return next;
      });
      setGraphDocument({ ...doc, edges });
      setSelection((prev) => {
        if (!prev || prev.kind !== "edge" || prev.id !== edgeId) {
          return prev;
        }
        return { ...prev, routeDescription: patch.routeDescription.trim().slice(0, 1024) };
      });
    },
    [commitHistorySnapshot],
  );

  const onConnectNewEdge = useCallback((edge: GraphEdgeJson) => {
    const api = canvasRef.current;
    if (!api) {
      return;
    }
    commitHistorySnapshot();
    const doc = api.exportDocument();
    const nextDoc = {
      ...doc,
      edges: [...(doc.edges ?? []), edge],
    };
    setGraphDocument(nextDoc);
    const src = edge.source;
    if (src != null && src !== "") {
      markStepCacheDirtyWithBubble(nextDoc, [src]);
    }
  }, [commitHistorySnapshot, markStepCacheDirtyWithBubble]);

  const onExportRemovedDanglingEdges = useCallback((removedEdgeIds: string[]) => {
    setDanglingEdgesExportIds(removedEdgeIds);
  }, []);

  const onFlowStructureChange = useCallback(() => {
    setDanglingEdgesExportIds(null);
    const api = canvasRef.current;
    if (!api) {
      return;
    }
    setGraphDocument(api.exportDocument());
  }, []);

  const onApplyGraphDocumentSettings = useCallback((patch: GraphDocumentSettingsPatch) => {
    commitHistorySnapshot();
    setGraphDocument((prev) => {
      const meta = { ...(prev.meta ?? {}) };
      if (patch.title !== undefined) {
        meta.title = patch.title;
      }
      if (patch.author !== undefined) {
        meta.author = patch.author;
      }
      if (patch.graphId !== undefined) {
        const gid = patch.graphId.trim();
        meta.graphId = gid;
      }
      if (patch.schemaVersion !== undefined) {
        meta.schemaVersion = patch.schemaVersion;
      }
      const next: GraphDocumentJson = {
        ...prev,
        meta,
      };
      if (patch.schemaVersion !== undefined) {
        next.schemaVersion = patch.schemaVersion;
      }
      if (patch.graphId !== undefined) {
        next.graphId = patch.graphId.trim();
      }
      if ("inputs" in patch) {
        if (patch.inputs === undefined) {
          delete next.inputs;
        } else {
          next.inputs = patch.inputs;
        }
      }
      if ("outputs" in patch) {
        if (patch.outputs === undefined) {
          delete next.outputs;
        } else {
          next.outputs = patch.outputs;
        }
      }
      return next;
    });
  }, [commitHistorySnapshot]);

  const onAddNode = useCallback(
    (
      pick: AddNodeMenuPick,
      flowPosition: { x: number; y: number },
      connectFrom?: { sourceNodeId: string; sourceHandle: string },
    ) => {
      if (runSessionHasBlockingActivity()) {
        return;
      }
      const api = canvasRef.current;
      if (!api) {
        return;
      }
      const doc = api.exportDocument();
      const nodes = doc.nodes ?? [];
      if (pick.kind === "template") {
        const tpl = builtInNodeTemplateById(pick.templateId);
        if (!tpl) {
          return;
        }
        commitHistorySnapshot();
        const merged = mergePastedSubgraph(doc, tpl.payload, {
          newNodeId: newGraphNodeId,
          newEdgeId: newGraphEdgeId,
          positionOffset: {
            x: flowPosition.x - tpl.anchor.x,
            y: flowPosition.y - tpl.anchor.y,
          },
        });
        setGraphDocument(merged);
        setLayoutDirtyEpoch((n) => n + 1);
        return;
      }
      if (pick.kind === "task_cursor_agent") {
        const id = newGraphNodeId();
        const parentId = pickCommentParentId(nodes, flowPosition.x, flowPosition.y);
        const newNode = {
          id,
          type: GRAPH_NODE_TYPE_TASK,
          position: { x: flowPosition.x, y: flowPosition.y },
          data: defaultCursorAgentTaskData(),
          ...(parentId ? { parentId } : {}),
        };
        commitHistorySnapshot();
        setGraphDocument(mergeNewNodeAndConnectEdge(doc, [...nodes, newNode], id, connectFrom));
        return;
      }
      if (pick.kind === "primitive") {
        if (pick.nodeType === "start" && nodes.some((n) => n.type === "start")) {
          window.alert(t("app.canvas.onlyOneStart"));
          return;
        }
        const id = newGraphNodeId();
        const data = defaultDataForNodeType(pick.nodeType);
        const parentId = !isGraphDocumentFrameType(pick.nodeType)
          ? pickCommentParentId(nodes, flowPosition.x, flowPosition.y)
          : undefined;
        const newNode = {
          id,
          type: pick.nodeType,
          position: { x: flowPosition.x, y: flowPosition.y },
          data,
          ...(parentId ? { parentId } : {}),
        };
        commitHistorySnapshot();
        setGraphDocument(mergeNewNodeAndConnectEdge(doc, [...nodes, newNode], id, connectFrom));
        return;
      }
      const id = newGraphNodeId();
      const parentId = pickCommentParentId(nodes, flowPosition.x, flowPosition.y);
      const newNode = {
        id,
        type: GRAPH_NODE_TYPE_GRAPH_REF,
        position: { x: flowPosition.x, y: flowPosition.y },
        data: { targetGraphId: pick.targetGraphId },
        ...(parentId ? { parentId } : {}),
      };
      commitHistorySnapshot();
      setGraphDocument(mergeNewNodeAndConnectEdge(doc, [...nodes, newNode], id, connectFrom));
    },
    [commitHistorySnapshot, setLayoutDirtyEpoch, t],
  );

  const onQuickAddStartFromWarning = useCallback(() => {
    if (runSessionBlocking || hasStartNode) {
      return;
    }
    const api = canvasRef.current;
    if (!api) {
      return;
    }
    const doc = api.exportDocument({ notifyRemovedDanglingEdges: false });
    const { nodes } = graphDocumentToFlow(doc);
    const cx =
      nodes.length > 0 ? nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length : 200;
    const cy =
      nodes.length > 0 ? nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length : 200;
    onAddNode({ kind: "primitive", nodeType: GRAPH_NODE_TYPE_START }, { x: cx + 40, y: cy });
  }, [hasStartNode, onAddNode, runSessionBlocking]);

  const canGroupSelection = useMemo(() => {
    if (runSessionBlocking) {
      return false;
    }
    if (selection?.kind !== "multiNode" || selection.ids.length < 2) {
      return false;
    }
    const { nodes } = graphDocumentToFlow(graphDocument);
    return canApplyGroupSelection(nodes as Node<GcNodeData>[], new Set(selection.ids));
  }, [runSessionBlocking, selection, graphDocument]);

  const canUngroupSelection = useMemo(() => {
    if (runSessionBlocking) {
      return false;
    }
    return selection?.kind === "node" && selection.graphNodeType === GRAPH_NODE_TYPE_GROUP;
  }, [runSessionBlocking, selection]);

  /** Prefer live canvas export (same path as align/apply) so parentId/positions match React FG. */
  const flowNodesForAlign = useMemo((): Node<GcNodeData>[] => {
    const api = canvasRef.current;
    if (api != null) {
      const doc = api.exportDocument({ notifyRemovedDanglingEdges: false });
      return graphDocumentToFlow(doc).nodes as Node<GcNodeData>[];
    }
    return graphDocumentToFlow(graphDocument).nodes as Node<GcNodeData>[];
  }, [
    graphDocument,
    layoutDirtyEpoch,
    selection?.kind === "multiNode" ? [...selection.ids].sort().join("\0") : "",
  ]);

  const canAlignSelection = useMemo(() => {
    if (runSessionBlocking) {
      return false;
    }
    if (selection?.kind !== "multiNode") {
      return false;
    }
    return alignSelectionPossible(flowNodesForAlign, new Set(selection.ids));
  }, [runSessionBlocking, selection, flowNodesForAlign]);

  const canDistributeSelection = useMemo(() => {
    if (runSessionBlocking) {
      return false;
    }
    if (selection?.kind !== "multiNode") {
      return false;
    }
    return distributeSelectionPossible(flowNodesForAlign, new Set(selection.ids));
  }, [runSessionBlocking, selection, flowNodesForAlign]);

  const performCanvasGroup = useCallback(() => {
    if (runSessionBlocking) {
      return;
    }
    const api = canvasRef.current;
    if (!api) {
      return;
    }
    const sel = selectionRef.current;
    if (sel?.kind !== "multiNode" || sel.ids.length < 2) {
      return;
    }
    const doc = api.exportDocument({ notifyRemovedDanglingEdges: false });
    const { nodes, edges } = graphDocumentToFlow(doc);
    const applied = applyGroupSelection(nodes, new Set(sel.ids));
    if (!applied) {
      setAppMessageModal(presentationForInspectorSimple(t, "app.canvas.groupSelectionNotPossible"));
      return;
    }
    const merged = flowToDocument(applied.nodes, edges, doc);
    const gNode = merged.nodes?.find((n) => n.id === applied.groupId);
    commitHistorySnapshot();
    setGraphDocument(merged);
    setLayoutDirtyEpoch((n) => n + 1);
    if (gNode) {
      const raw = gNode.data ?? {};
      setSelection({
        kind: "node",
        id: gNode.id,
        graphNodeType: gNode.type,
        label: nodeLabel(raw, gNode.id),
        raw: raw as Record<string, unknown>,
      });
    }
  }, [commitHistorySnapshot, runSessionBlocking, t]);

  const performCanvasUngroup = useCallback(() => {
    if (runSessionBlocking) {
      return;
    }
    const api = canvasRef.current;
    if (!api) {
      return;
    }
    const sel = selectionRef.current;
    if (sel?.kind !== "node" || sel.graphNodeType !== GRAPH_NODE_TYPE_GROUP) {
      return;
    }
    const doc = api.exportDocument({ notifyRemovedDanglingEdges: false });
    const { nodes, edges } = graphDocumentToFlow(doc);
    const next = applyUngroupSelection(nodes, sel.id);
    if (!next) {
      setAppMessageModal(presentationForInspectorSimple(t, "app.canvas.ungroupNotPossible"));
      return;
    }
    commitHistorySnapshot();
    setGraphDocument(flowToDocument(next, edges, doc));
    setLayoutDirtyEpoch((n) => n + 1);
    setSelection(null);
  }, [commitHistorySnapshot, runSessionBlocking, t]);

  const performCanvasAlignDistribute = useCallback(
    (op: AlignDistributeOp) => {
      if (runSessionBlocking) {
        return;
      }
      const api = canvasRef.current;
      if (!api) {
        return;
      }
      const sel = selectionRef.current;
      if (sel?.kind !== "multiNode") {
        return;
      }
      const idSet = new Set(sel.ids);
      const doc = api.exportDocument({ notifyRemovedDanglingEdges: false });
      const { nodes, edges } = graphDocumentToFlow(doc);
      const next = applyAlignDistribute(nodes as Node<GcNodeData>[], idSet, op);
      if (!next) {
        setAppMessageModal(
          presentationForInspectorSimple(t, "app.canvas.alignDistributeNoChange"),
        );
        return;
      }
      const merged = flowToDocument(next, edges, doc);
      commitHistorySnapshot();
      setGraphDocument(merged);
      setLayoutDirtyEpoch((n) => n + 1);
    },
    [commitHistorySnapshot, runSessionBlocking, t],
  );

  const runStartDisabled =
    pyProbe != null && !pyProbe.ok;

  const onRemoveCanvasNodes = useCallback((ids: readonly string[]) => {
    if (runSessionBlocking) {
      return;
    }
    canvasRef.current?.removeNodesById(ids);
  }, [runSessionBlocking]);

  const onOpenNestedGraph = useCallback(
    (targetGraphId: string, graphRefNodeId?: string) => {
      const tid = targetGraphId.trim();
      if (!tid) {
        return;
      }
      if (!workspaceGraphsDir) {
        window.alert(t("app.workspace.needLinkForGraphRef"));
        return;
      }
      const matches = workspaceIndex.filter((e) => e.graphId === tid);
      if (matches.length === 0) {
        window.alert(t("app.workspace.graphNotInIndex", { id: tid }));
        return;
      }
      const parentFile = activeWorkspaceFile;
      const grId = graphRefNodeId?.trim() ?? "";
      const nestedFrameToAppend =
        parentFile != null && grId !== ""
          ? { parentWorkspaceFileName: parentFile, graphRefNodeId: grId }
          : undefined;
      void onOpenWorkspaceGraph(matches[0].fileName, {
        keepNestedStack: true,
        nestedFrameToAppend,
      });
    },
    [activeWorkspaceFile, onOpenWorkspaceGraph, t, workspaceGraphsDir, workspaceIndex],
  );

  useEffect(() => {
    setSelection((sel) => {
      if (!sel) {
        return sel;
      }
      const nodes = graphDocument.nodes ?? [];
      const edges = graphDocument.edges ?? [];
      if (sel.kind === "node") {
        if (!nodes.some((n) => n.id === sel.id)) {
          return null;
        }
        return sel;
      }
      if (sel.kind === "multiNode") {
        const alive = sel.ids.filter((id) => nodes.some((n) => n.id === id));
        if (alive.length === 0) {
          return null;
        }
        if (alive.length === 1) {
          const n = nodes.find((x) => x.id === alive[0]);
          if (!n) {
            return null;
          }
          const raw = n.data ?? {};
          return {
            kind: "node",
            id: n.id,
            graphNodeType: n.type,
            label: nodeLabel(raw, n.id),
            raw,
          };
        }
        const rows = alive.map((id) => {
          const n = nodes.find((x) => x.id === id);
          if (!n) {
            return { id, graphNodeType: "unknown", label: id };
          }
          const raw = n.data ?? {};
          return {
            id,
            graphNodeType: n.type,
            label: nodeLabel(raw, id),
          };
        });
        return { kind: "multiNode", ids: alive, nodes: rows };
      }
      if (sel.kind === "edge") {
        const ej = edges.find((e) => e.id === sel.id);
        if (!ej) {
          return null;
        }
        const d = ej.data;
        const rd =
          d != null && typeof d === "object" && !Array.isArray(d) && typeof d.routeDescription === "string"
            ? d.routeDescription
            : "";
        const cond = ej.condition != null && String(ej.condition).trim() !== "" ? String(ej.condition) : null;
        return { ...sel, condition: cond, routeDescription: rd };
      }
      return sel;
    });
  }, [graphDocument]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key !== "c" && key !== "v") {
        return;
      }
      if (isTextEditingTarget(e.target)) {
        return;
      }
      if (nodeSearchOpenRef.current) {
        return;
      }
      const sel = selectionRef.current;
      const doc =
        canvasRef.current?.exportDocument({ notifyRemovedDanglingEdges: false }) ??
        graphDocumentRef.current;
      if (key === "c") {
        let ids: Set<string> | null = null;
        if (sel?.kind === "node") {
          ids = new Set([sel.id]);
        } else if (sel?.kind === "multiNode") {
          ids = new Set(sel.ids);
        }
        if (!ids || ids.size === 0) {
          return;
        }
        const payload = buildClipboardPayload(doc, ids);
        if (!payload) {
          return;
        }
        e.preventDefault();
        void navigator.clipboard.writeText(JSON.stringify(payload)).then(
          () => {
            pushToast(t("app.toast.copiedNodes"), "success");
          },
          () => {
            window.alert(t("app.inspector.clipboardCopyFailed"));
          },
        );
        return;
      }
      if (runSessionBlocking) {
        return;
      }
      e.preventDefault();
      void (async () => {
        let raw: string;
        try {
          raw = await navigator.clipboard.readText();
        } catch {
          return;
        }
        const payload = parseClipboardPayload(raw);
        if (!payload) {
          window.alert(t("app.inspector.clipboardInvalid"));
          return;
        }
        const base =
          canvasRef.current?.exportDocument({ notifyRemovedDanglingEdges: false }) ??
          graphDocumentRef.current;
        const merged = mergePastedSubgraph(base, payload, {
          newNodeId: newGraphNodeId,
          newEdgeId: newGraphEdgeId,
          positionOffset: { x: 32, y: 32 },
        });
        const beforeIds = new Set((base.nodes ?? []).map((n) => n.id));
        const newIds = (merged.nodes ?? []).map((n) => n.id).filter((id) => !beforeIds.has(id));
        if (newIds.length === 0) {
          return;
        }
        commitHistorySnapshot();
        setGraphDocument(merged);
        setLayoutDirtyEpoch((n) => n + 1);
        const mergedNodes = merged.nodes ?? [];
        const rows = newIds.map((id) => {
          const n = mergedNodes.find((x) => x.id === id);
          if (!n) {
            return { id, graphNodeType: "unknown", label: id };
          }
          const rawData = n.data ?? {};
          return {
            id,
            graphNodeType: n.type,
            label: nodeLabel(rawData, id),
          };
        });
        const first = rows[0];
        if (newIds.length === 1 && first) {
          const sole = mergedNodes.find((x) => x.id === first.id);
          const rawData = sole?.data ?? {};
          setSelection({
            kind: "node",
            id: first.id,
            graphNodeType: first.graphNodeType,
            label: first.label,
            raw: rawData as Record<string, unknown>,
          });
        } else {
          setSelection({ kind: "multiNode", ids: newIds, nodes: rows });
        }
      })();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [commitHistorySnapshot, pushToast, runSessionBlocking, t]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        return;
      }
      if (e.key.toLowerCase() !== "g") {
        return;
      }
      if (isTextEditingTarget(e.target)) {
        return;
      }
      if (nodeSearchOpenRef.current) {
        return;
      }
      if (runSessionBlocking) {
        return;
      }
      if (e.shiftKey) {
        if (!canUngroupSelection) {
          return;
        }
        e.preventDefault();
        performCanvasUngroup();
        return;
      }
      if (!canGroupSelection) {
        return;
      }
      e.preventDefault();
      performCanvasGroup();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    canGroupSelection,
    canUngroupSelection,
    performCanvasGroup,
    performCanvasUngroup,
    runSessionBlocking,
  ]);

  const followRunCameraActive =
    runSession.replaySourceLabel != null ||
    (runSession.focusedRunId != null &&
      runSession.liveRunIds.includes(runSession.focusedRunId));

  return (
    <div className="app-root" data-gc-history-revision={historyTick}>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="gc-hidden-file-input"
        onChange={onFileChange}
      />
      <TopBar
        onLangChange={onLangChange}
        onNewGraph={onNewGraph}
        onOpenGraph={onOpenPick}
        onSaveGraph={onSaveGraph}
        canUndo={historyRef.current.past.length > 0}
        canRedo={historyRef.current.future.length > 0}
        onUndo={performUndo}
        onRedo={performRedo}
        canGroupSelection={canGroupSelection}
        canUngroupSelection={canUngroupSelection}
        onGroupSelection={performCanvasGroup}
        onUngroupSelection={performCanvasUngroup}
        snapToGridEnabled={snapToGridEnabled}
        onSnapToGridChange={(on) => {
          writeSnapGridEnabled(on);
          setSnapToGridEnabled(on);
        }}
        ghostOffViewportEnabled={ghostOffViewportEnabled}
        onGhostOffViewportChange={(on) => {
          writeGhostOffViewportEnabled(on);
          setGhostOffViewportEnabled(on);
        }}
        edgeLabelsEnabled={edgeLabelsEnabled}
        onEdgeLabelsChange={(on) => {
          writeEdgeLabelsEnabled(on);
          setEdgeLabelsEnabled(on);
        }}
        followRunEnabled={followRunEnabled}
        onFollowRunChange={(on) => {
          writeFollowRunPreference(on);
          setFollowRunEnabled(on);
        }}
        runMotionPreference={runMotionPreference}
        onRunMotionPreferenceChange={(mode) => {
          writeRunMotionPreference(mode);
          setRunMotionPreference(mode);
        }}
        canAlignSelection={canAlignSelection}
        canDistributeSelection={canDistributeSelection}
        onAlignDistribute={performCanvasAlignDistribute}
        workspaceLinked={workspaceGraphsDir != null}
        onLinkWorkspace={() => {
          void onLinkWorkspace();
        }}
        workspaceGraphOptions={workspaceGraphOptions}
        onOpenWorkspaceGraph={(name) => {
          void onOpenWorkspaceGraph(name);
        }}
        onOpenFindNode={() => {
          setNodeSearchOpen(true);
        }}
        onOpenKeyboardShortcuts={() => {
          setKeyboardShortcutsOpen(true);
        }}
        showRunControls
        runGraphsDir={runGraphsDir}
        runArtifactsBase={runArtifactsBase}
        onRunGraphsDirChange={setRunGraphsDir}
        onRunArtifactsBaseChange={setRunArtifactsBase}
        stepCacheRunEnabled={stepCacheRunEnabled}
        onStepCacheRunEnabledChange={setStepCacheRunEnabled}
        hasArtifactsBase={runArtifactsBase.trim() !== ""}
        stepCacheDirtyCount={stepCacheDirtyCount}
        onRun={() => {
          void onRunGraph();
        }}
        onRunHistory={() => {
          setRunHistoryOpen(true);
        }}
        canClearSettledRunVisual={runSession.canClearSettledRunVisual}
        onClearSettledRunVisual={() => {
          runSessionClearSettledVisualForCurrentGraph();
        }}
        runHistoryDisabled={
          runArtifactsBase.trim() === "" || resolvedGraphId.trim() === "" || resolvedGraphId.trim() === "default"
        }
        onStopRun={() => {
          void onStopRunGraph();
        }}
        sessionBlocking={runSessionBlocking}
        hasLiveRun={hasLiveGraphRun}
        liveRunIds={runSession.liveRunIds}
        focusedRunId={runSession.focusedRunId}
        onFocusedRunChange={(rid) => {
          runSessionSetFocusedRunId(rid);
        }}
        pendingRunCount={runSession.pendingRunCount}
        runStartDisabled={runStartDisabled}
        runDesktopOnlyHint={false}
      />
      {branchIssues.length > 0 ||
      structureIssues.length > 0 ||
      handleIssues.length > 0 ||
      autosaveFailed ||
      (danglingEdgesExportIds != null && danglingEdgesExportIds.length > 0) ? (
        <div className="gc-branch-warnings" role="status">
          {autosaveFailed ? (
            <div className="gc-branch-warnings__line">
              <span aria-hidden="true">⚠</span> {t("app.editor.autosaveFailedBanner")}
            </div>
          ) : null}
          {danglingEdgesExportIds != null && danglingEdgesExportIds.length > 0 ? (
            <div className="gc-branch-warnings__line">
              <span aria-hidden="true">⚠</span>{" "}
              {t("app.editor.removedDanglingEdges", {
                count: danglingEdgesExportIds.length,
                ids:
                  danglingEdgesExportIds.length <= 8
                    ? danglingEdgesExportIds.join(", ")
                    : `${danglingEdgesExportIds.slice(0, 8).join(", ")} (+${danglingEdgesExportIds.length - 8})`,
              })}
            </div>
          ) : null}
          {structureIssues.map((issue, idx) => {
            const stFocusNid = structureIssueFocusNodeId(issue);
            return (
            <div key={`st-${issue.kind}-${idx}`} className="gc-branch-warnings__line">
              <span>
              <span aria-hidden="true">⚠</span>{" "}
              {issue.kind === "no_start"
                ? t("app.structure.noStart")
                : issue.kind === "multiple_starts"
                  ? t("app.structure.multipleStarts", { ids: issue.ids.join(", ") })
                  : issue.kind === "unreachable_nodes"
                    ? t("app.structure.unreachableNodes", {
                        ids:
                          issue.ids.length <= 12
                            ? issue.ids.join(", ")
                            : `${issue.ids.slice(0, 12).join(", ")} (+${issue.ids.length - 12})`,
                      })
                    : issue.kind === "graph_ref_workspace_cycle"
                      ? t("app.structure.graphRefWorkspaceCycle", {
                          cycle: formatGraphRefCycleForUi(issue.cycle),
                        })
                      : issue.kind === "merge_few_inputs"
                        ? t("app.structure.mergeFewInputs", {
                            id: issue.nodeId,
                            count: issue.incomingEdges,
                          })
                        : issue.kind === "fork_few_outputs"
                          ? t("app.structure.forkFewOutputs", {
                              id: issue.nodeId,
                              count: issue.unconditionalOutgoing,
                            })
                          : issue.kind === "barrier_merge_out_error_incoming"
                            ? t("app.structure.barrierMergeOutErrorIncoming", {
                                edgeId: issue.edgeId,
                                mergeId: issue.mergeNodeId,
                              })
                            : issue.kind === "barrier_merge_no_success_incoming"
                              ? t("app.structure.barrierMergeNoSuccessIncoming", {
                                  id: issue.nodeId,
                                })
                              : issue.kind === "ai_route_no_outgoing"
                                ? t("app.structure.aiRouteNoOutgoing", { id: issue.nodeId })
                                : issue.kind === "ai_route_missing_route_descriptions"
                                  ? t("app.structure.aiRouteMissingDescriptions", {
                                      id: issue.nodeId,
                                      missing: issue.missingDescriptions,
                                      total: issue.outgoingEdges,
                                    })
                                  : issue.kind === "llm_agent_empty_command"
                                    ? t("app.structure.llmAgentEmptyCommand", { id: issue.nodeId })
                                    : issue.kind === "agent_missing_prompt"
                                      ? t("app.structure.agentMissingPrompt", { id: issue.nodeId })
                                    : issue.kind === "http_request_empty_url"
                                      ? t("app.structure.httpRequestEmptyUrl", { id: issue.nodeId })
                                      : issue.kind === "rag_query_empty_url"
                                        ? t("app.structure.ragQueryEmptyUrl", { id: issue.nodeId })
                                        : issue.kind === "rag_query_empty_query"
                                          ? t("app.structure.ragQueryEmptyQuery", { id: issue.nodeId })
                                          : issue.kind === "rag_memory_empty_collection"
                                            ? t("app.structure.ragMemoryEmptyCollection", {
                                                id: issue.nodeId,
                                              })
                                            : issue.kind === "rag_index_empty_collection_id"
                                              ? t("app.structure.ragIndexEmptyCollectionId", {
                                                  id: issue.nodeId,
                                                })
                                              : issue.kind === "rag_index_empty_text"
                                                ? t("app.structure.ragIndexEmptyText", {
                                                    id: issue.nodeId,
                                                  })
                                                : issue.kind === "delay_invalid_duration"
                                                  ? t("app.structure.delayInvalidDuration", {
                                                      id: issue.nodeId,
                                                    })
                                                  : issue.kind === "debounce_invalid_duration"
                                                    ? t("app.structure.debounceInvalidDuration", {
                                                        id: issue.nodeId,
                                                      })
                                                    : issue.kind === "wait_for_unknown_mode"
                                                      ? t("app.structure.waitForUnknownMode", {
                                                          id: issue.nodeId,
                                                        })
                                                      : issue.kind === "wait_for_empty_path"
                                                        ? t("app.structure.waitForEmptyPath", {
                                                            id: issue.nodeId,
                                                          })
                                                        : issue.kind === "wait_for_invalid_timeout"
                                                          ? t("app.structure.waitForInvalidTimeout", {
                                                              id: issue.nodeId,
                                                            })
                                                          : issue.kind === "python_code_empty_code"
                                                            ? t("app.structure.pythonCodeEmptyCode", {
                                                                id: issue.nodeId,
                                                              })
                                                            : issue.kind === "set_variable_invalid_config"
                                                              ? t("app.structure.setVariableInvalidConfig", {
                                                                  id: issue.nodeId,
                                                                })
                                                              : issue.kind === "mcp_tool_empty_tool_name"
                                                                ? t("app.structure.mcpToolEmptyToolName", {
                                                                    id: issue.nodeId,
                                                                  })
                                                                : issue.kind === "mcp_tool_stdio_missing_command"
                                                                  ? t("app.structure.mcpToolStdioMissingCommand", {
                                                                      id: issue.nodeId,
                                                                    })
                                                                  : issue.kind === "mcp_tool_http_empty_url"
                                                                    ? t("app.structure.mcpToolHttpEmptyUrl", {
                                                                        id: issue.nodeId,
                                                                      })
                                                                    : issue.kind === "mcp_tool_unknown_transport"
                                                                      ? t("app.structure.mcpToolUnknownTransport", {
                                                                          id: issue.nodeId,
                                                                          transport: issue.transport,
                                                                        })
                                                                      : issue.kind === "schema_version_mismatch"
                                                                        ? t("app.structure.schemaVersionMismatch", {
                                                                            root: issue.root,
                                                                            meta: issue.meta,
                                                                          })
                                                                        : issue.kind === "trigger_has_incoming"
                                                                          ? t("app.structure.triggerHasIncoming", {
                                                                              id: issue.nodeId,
                                                                              type: issue.triggerType,
                                                                            })
                                                                          : issue.kind === "start_has_incoming"
                                                                            ? t("app.structure.startHasIncoming", {
                                                                                id: issue.startId,
                                                                              })
                                                                            : t("app.structure.unknownIssue", {
                                                                                kind: String(
                                                                                  (issue as { kind: string }).kind,
                                                                                ),
                                                                              })}
              </span>
              {!runSessionBlocking ? (
                <span className="gc-branch-warnings__actions">
                  {issue.kind === "no_start" && !hasStartNode ? (
                    <button
                      type="button"
                      className="gc-branch-warnings__btn"
                      onClick={onQuickAddStartFromWarning}
                    >
                      {t("app.warnings.quickFixAddStart")}
                    </button>
                  ) : null}
                  {stFocusNid ? (
                    <button
                      type="button"
                      className="gc-branch-warnings__btn"
                      onClick={() => {
                        onConsoleNavigateToNode(stFocusNid);
                      }}
                    >
                      {t("app.warnings.quickFixFocusNode")}
                    </button>
                  ) : null}
                </span>
              ) : null}
            </div>
            );
          })}
          {handleIssues.map((issue, idx) => (
            <div
              key={`hdl-${issue.kind}-${issue.edgeId}-${idx}`}
              className="gc-branch-warnings__line"
            >
              <span>
              <span aria-hidden="true">⚠</span>{" "}
              {issue.kind === "invalid_source_handle"
                ? t("app.warnings.invalidSourceHandle", {
                    edgeId: issue.edgeId,
                    nodeId: issue.sourceId,
                    nodeType: issue.sourceType,
                    handle: issue.handle,
                  })
                : issue.kind === "invalid_target_handle"
                  ? t("app.warnings.invalidTargetHandle", {
                      edgeId: issue.edgeId,
                      nodeId: issue.targetId,
                      nodeType: issue.targetType,
                      handle: issue.handle,
                    })
                  : issue.kind === "port_data_kind_mismatch"
                    ? t("app.warnings.portDataKindMismatch", {
                        edgeId: issue.edgeId,
                        sourceId: issue.sourceId,
                        targetId: issue.targetId,
                        sourceKind: issue.sourceKind,
                        targetKind: issue.targetKind,
                      })
                    : t("app.warnings.portDataKindIncompatible", {
                        edgeId: issue.edgeId,
                        sourceId: issue.sourceId,
                        targetId: issue.targetId,
                        sourceKind: issue.sourceKind,
                        targetKind: issue.targetKind,
                      })}
              </span>
              {!runSessionBlocking ? (
                <span className="gc-branch-warnings__actions">
                  <button
                    type="button"
                    className="gc-branch-warnings__btn"
                    onClick={() => {
                      onWarningFocusEdge(issue.edgeId);
                    }}
                  >
                    {t("app.warnings.quickFixFocusEdge")}
                  </button>
                  <button
                    type="button"
                    className="gc-branch-warnings__btn"
                    onClick={() => {
                      onConsoleNavigateToNode(handleIssuePrimaryNodeId(issue));
                    }}
                  >
                    {t("app.warnings.quickFixFocusNode")}
                  </button>
                </span>
              ) : null}
            </div>
          ))}
          {branchIssues.map((issue, idx) => (
            <div
              key={`${issue.edgeId ?? issue.sourceId}-${issue.handleFanout}-${issue.kind}-${idx}`}
              className="gc-branch-warnings__line"
            >
              <span>
              <span aria-hidden="true">⚠</span>{" "}
              {issue.kind === "out_error_unreachable"
                ? t("app.warnings.outErrorUnreachable", { sourceId: issue.sourceId })
                : issue.kind === "template_condition_invalid"
                  ? issue.detail === "unclosed"
                    ? t("app.warnings.templateConditionUnclosed", {
                        sourceId: issue.sourceId,
                        edgeId: issue.edgeId ?? "",
                      })
                    : issue.detail === "too_many"
                      ? t("app.warnings.templateConditionTooMany", {
                          sourceId: issue.sourceId,
                          edgeId: issue.edgeId ?? "",
                        })
                      : issue.detail === "too_long"
                        ? t("app.warnings.templateConditionTooLong", {
                            sourceId: issue.sourceId,
                            edgeId: issue.edgeId ?? "",
                          })
                        : t("app.warnings.templateConditionInvalid", {
                            sourceId: issue.sourceId,
                            edgeId: issue.edgeId ?? "",
                          })
                  : issue.kind === "multiple_unconditional"
                    ? issue.handleFanout === "error"
                      ? t("app.warnings.multipleUnconditionalErrorOut", { sourceId: issue.sourceId })
                      : t("app.warnings.multipleUnconditional", { sourceId: issue.sourceId })
                    : issue.handleFanout === "error"
                      ? t("app.warnings.duplicateConditionErrorOut", {
                          sourceId: issue.sourceId,
                          detail: issue.detail ?? "",
                        })
                      : t("app.warnings.duplicateCondition", {
                          sourceId: issue.sourceId,
                          detail: issue.detail ?? "",
                        })}
              </span>
              {!runSessionBlocking ? (
                <span className="gc-branch-warnings__actions">
                  <button
                    type="button"
                    className="gc-branch-warnings__btn"
                    onClick={() => {
                      onConsoleNavigateToNode(branchIssueFocusNodeId(issue));
                    }}
                  >
                    {t("app.warnings.quickFixFocusNode")}
                  </button>
                  {branchIssueFocusEdgeId(issue) ? (
                    <button
                      type="button"
                      className="gc-branch-warnings__btn"
                      onClick={() => {
                        onWarningFocusEdge(branchIssueFocusEdgeId(issue) ?? "");
                      }}
                    >
                      {t("app.warnings.quickFixFocusEdge")}
                    </button>
                  ) : null}
                  {issue.kind === "template_condition_invalid" && issue.edgeId ? (
                    <button
                      type="button"
                      className="gc-branch-warnings__btn"
                      onClick={() => {
                        onQuickClearEdgeCondition(issue.edgeId ?? "");
                      }}
                    >
                      {t("app.warnings.quickFixClearCondition")}
                    </button>
                  ) : null}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="gc-main-row">
        <NodePaletteSidebar
          isOpen={nodePaletteSidebarOpen}
          onToggle={() => setNodePaletteSidebarOpen((prev) => !prev)}
          hasStartNode={hasStartNode}
          workspaceGraphs={workspaceGraphRows}
          onNodeClick={(pick) => {
            const api = canvasRef.current;
            if (!api) {
              return;
            }
            const doc = api.exportDocument({ notifyRemovedDanglingEdges: false });
            const { nodes } = graphDocumentToFlow(doc);
            const centerX = nodes.length > 0
              ? nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length + 100
              : 200;
            const centerY = nodes.length > 0
              ? nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length
              : 200;
            onAddNode(pick, { x: centerX, y: centerY });
          }}
        />
        <div className="gc-canvas">
          <div className="gc-canvas-inner">
            <GraphCanvas
              ref={canvasRef}
              graphDocument={graphDocument}
              layoutEpoch={layoutEpoch}
              onSelect={setSelection}
              workspaceGraphsForAddMenu={workspaceGraphRows}
              onAddNode={onAddNode}
              onConnectNewEdge={onConnectNewEdge}
              onExportRemovedDanglingEdges={onExportRemovedDanglingEdges}
              onFlowStructureChange={onFlowStructureChange}
              onBeforeStructureRemove={commitHistorySnapshot}
              onNodeDragCaptureBegin={beginNodeDragCapture}
              onBeforeNodeDragStructureSync={commitNodeDragHistoryIfChanged}
              structureLocked={runSessionBlocking}
              snapToGridEnabled={snapToGridEnabled}
              edgeLabelsEnabled={edgeLabelsEnabled}
              ghostOffViewportEnabled={ghostOffViewportEnabled}
              runHighlightNodeId={runSession.activeNodeId}
              nodeRunOverlayById={runSession.nodeRunOverlayByNodeId}
              nodeRunOverlayRevision={runSession.nodeRunOverlayRevision}
              highlightedRunEdgeId={runSession.highlightedRunEdgeId}
              edgeRunOverlayRevision={runSession.edgeRunOverlayRevision}
              runMotionPreference={runMotionPreference}
              followRunCameraEnabled={followRunEnabled}
              followRunCameraActive={followRunCameraActive}
              warningEdgeIds={canvasWarningEdgeIds}
              onNodeDragEnd={() => {
                setLayoutDirtyEpoch((n) => n + 1);
              }}
            />
          </div>
          <OnboardingTips enabled />
        </div>
        <InspectorPanel
          selection={selection}
          graphDocument={graphDocument}
          getDocumentForStepCacheDirty={getDocumentForStepCacheDirty}
          onApplyGraphDocumentSettings={onApplyGraphDocumentSettings}
          onApplyNodeData={onApplyNodeData}
          onApplyEdgeCondition={onApplyEdgeCondition}
          onApplyEdgeData={onApplyEdgeData}
          onRemoveNodes={onRemoveCanvasNodes}
          workspaceLinked={workspaceGraphsDir != null}
          onOpenNestedGraph={onOpenNestedGraph}
          loadGraphRefSnapshot={loadGraphRefSnapshot}
          getGraphRefWorkspaceHint={getGraphRefWorkspaceHint}
          onMarkStepCacheDirtyTransitive={markStepCacheDirtyWithBubble}
          runLocked={runSessionBlocking}
          onRunUntilThisNode={onRunUntilSelectedNode}
          runUntilThisNodeEnabled={runUntilSelectionEnabled}
          onUserMessage={setAppMessageModal}
        />
      </div>
      <ConsolePanel heightPx={height} onResizeStart={startDrag} onNavigateToNode={onConsoleNavigateToNode} />
      <GraphSaveModal
        open={saveModalOpen}
        suggestedFileName={saveModalSuggestedName}
        workspaceLinked={workspaceGraphsDir != null}
        workspaceEntries={workspaceIndex}
        getDocument={() =>
          canvasRef.current?.exportDocument({ notifyRemovedDanglingEdges: false }) ?? null
        }
        onSaveToWorkspace={(fileName, doc) => saveDocumentToWorkspace(doc, fileName)}
        onMarkDiskConflictOverwrite={markDiskConflictOverwrite}
        onSuccessfulSave={() => {
          pushToast(t("app.toast.saved"), "success");
        }}
        onClose={() => {
          setSaveModalOpen(false);
        }}
      />
      <KeyboardShortcutsModal
        open={keyboardShortcutsOpen}
        onClose={() => {
          setKeyboardShortcutsOpen(false);
        }}
      />
      <WorkspaceFileConflictModal
        open={workspaceAutosaveConflictOpen}
        fileName={activeWorkspaceFile ?? ""}
        onReload={onAutosaveDiskConflictReload}
        onOverwrite={() => void onAutosaveDiskConflictOverwrite()}
        onPauseAutosave={onAutosaveDiskConflictPause}
      />
      <OpenGraphErrorModal
        open={appMessageModal != null}
        presentation={appMessageModal}
        onClose={() => {
          setAppMessageModal(null);
        }}
      />
      <RunHistoryModal
        open={runHistoryOpen}
        onClose={() => {
          setRunHistoryOpen(false);
        }}
        artifactsBase={runArtifactsBase}
        graphId={resolvedGraphId}
      />
      <NodeSearchPalette
        open={nodeSearchOpen}
        allRows={nodeSearchRows}
        onClose={() => {
          setNodeSearchOpen(false);
        }}
        onPick={(nodeId) => {
          setNodeSearchOpen(false);
          onConsoleNavigateToNode(nodeId);
        }}
      />
    </div>
  );
}
