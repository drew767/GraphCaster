// Copyright GraphCaster. All Rights Reserved.

import exampleDocument from "@schemas/graph-document.example.json";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";

import type { GraphCanvasHandle, GraphCanvasSelection } from "../components/GraphCanvas";
import type { AddNodeMenuPick, WorkspaceGraphAddMenuRow } from "../graph/addNodeMenu";
import { GraphCanvas } from "../components/GraphCanvas";
import { ConsolePanel } from "../components/ConsolePanel";
import { OpenGraphErrorModal } from "../components/OpenGraphErrorModal";
import { GraphSaveModal } from "../components/GraphSaveModal";
import { InspectorPanel } from "../components/InspectorPanel";
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
} from "../graph/types";
import { findBranchAmbiguities } from "../graph/branchWarnings";
import { pickCommentParentId } from "../graph/flowHierarchy";
import { defaultDataForNodeType, newGraphNodeId } from "../graph/nodePalette";
import { GRAPH_NODE_TYPE_COMMENT, GRAPH_NODE_TYPE_GRAPH_REF } from "../graph/nodeKinds";
import type { OpenGraphErrorPresentation } from "../graph/openGraphErrorPresentation";
import {
  presentationForJsonSyntaxError,
  presentationForParseError,
  presentationForReadFailure,
} from "../graph/openGraphErrorPresentation";
import { graphIdFromDocument, parseGraphDocumentJson, parseGraphDocumentJsonResult } from "../graph/parseDocument";
import { findHandleCompatibilityIssues } from "../graph/handleCompatibility";
import { findStructureIssues, structureIssuesBlockRun } from "../graph/structureWarnings";
import { nodeLabel } from "../graph/toReactFlow";
import {
  defaultWorkspaceFileName,
  ensureGraphsDirectory,
  findWorkspaceGraphIdConflict,
  pickProjectRootDirectory,
  readWorkspaceGraphFile,
  sanitizeWorkspaceGraphFileName,
  scanWorkspaceGraphs,
  supportsFileSystemAccess,
  writeJsonFileToDir,
  type WorkspaceGraphEntry,
} from "../lib/workspaceFs";
import { useConsoleHeight } from "../hooks/useConsoleHeight";
import { gcCancelRun, gcStartRun, getRunEnvironmentInfo } from "../run/runCommands";
import {
  getRunSessionSnapshot,
  runSessionAppendLine,
  runSessionSetActiveRunId,
  runSessionSetPythonBanner,
  useRunSession,
} from "../run/runSessionStore";
import { isTauriRuntime } from "../run/tauriEnv";
import { useRunBridge } from "../run/useRunBridge";

const LS_RUN_GRAPHS = "gc.run.graphsDir";
const LS_RUN_ARTIFACTS = "gc.run.artifactsBase";

const DOCUMENT_HISTORY_CAP = 80;

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  return target.closest("input, textarea, select, [contenteditable='true']") != null;
}

type Props = {
  onLangChange: (lng: string) => void;
};

export function AppShell({ onLangChange }: Props) {
  const { t } = useTranslation();
  useRunBridge();
  const runSession = useRunSession();
  const isRunActive = runSession.activeRunId != null;
  const { height, startDrag } = useConsoleHeight(168);
  const [selection, setSelection] = useState<GraphCanvasSelection | null>(null);
  const [graphDocument, setGraphDocument] = useState<GraphDocumentJson>(() => {
    const parsed = parseGraphDocumentJson(exampleDocument as unknown);
    return parsed ?? createMinimalGraphDocument();
  });
  const branchIssues = useMemo(() => findBranchAmbiguities(graphDocument), [graphDocument]);
  const structureIssues = useMemo(() => findStructureIssues(graphDocument), [graphDocument]);
  const handleIssues = useMemo(() => findHandleCompatibilityIssues(graphDocument), [graphDocument]);
  const [danglingEdgesExportIds, setDanglingEdgesExportIds] = useState<string[] | null>(null);

  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const [workspaceGraphsDir, setWorkspaceGraphsDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [workspaceIndex, setWorkspaceIndex] = useState<WorkspaceGraphEntry[]>([]);
  const [activeWorkspaceFile, setActiveWorkspaceFile] = useState<string | null>(null);
  const [layoutDirtyEpoch, setLayoutDirtyEpoch] = useState(0);
  const canvasRef = useRef<GraphCanvasHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveModalSuggestedName, setSaveModalSuggestedName] = useState("graph.json");
  const [graphOpenError, setGraphOpenError] = useState<OpenGraphErrorPresentation | null>(null);
  const [runGraphsDir, setRunGraphsDir] = useState(() => localStorage.getItem(LS_RUN_GRAPHS) ?? "");
  const [runArtifactsBase, setRunArtifactsBase] = useState(
    () => localStorage.getItem(LS_RUN_ARTIFACTS) ?? "",
  );
  const [pyProbe, setPyProbe] = useState<{ ok: boolean; path: string } | null>(null);
  const historyRef = useRef(createEmptyHistory(DOCUMENT_HISTORY_CAP));
  const preDragDocumentRef = useRef<GraphDocumentJson | null>(null);
  const graphDocumentRef = useRef(graphDocument);
  graphDocumentRef.current = graphDocument;
  const [historyTick, setHistoryTick] = useState(0);

  const bumpHistoryUi = useCallback(() => {
    setHistoryTick((n) => n + 1);
  }, []);

  const commitHistorySnapshot = useCallback(() => {
    preDragDocumentRef.current = null;
    if (getRunSessionSnapshot().activeRunId != null) {
      return;
    }
    const current =
      canvasRef.current?.exportDocument({ notifyRemovedDanglingEdges: false }) ??
      graphDocumentRef.current;
    historyRef.current = snapshotBeforeChange(historyRef.current, current);
    bumpHistoryUi();
  }, [bumpHistoryUi]);

  const beginNodeDragCapture = useCallback(() => {
    if (getRunSessionSnapshot().activeRunId != null) {
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
    if (getRunSessionSnapshot().activeRunId != null) {
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
    if (getRunSessionSnapshot().activeRunId != null) {
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
    if (getRunSessionSnapshot().activeRunId != null) {
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
      if (getRunSessionSnapshot().activeRunId != null) {
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
    localStorage.setItem(LS_RUN_GRAPHS, runGraphsDir);
  }, [runGraphsDir]);
  useEffect(() => {
    localStorage.setItem(LS_RUN_ARTIFACTS, runArtifactsBase);
  }, [runArtifactsBase]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      runSessionSetPythonBanner(null);
      setPyProbe(null);
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
    try {
      setWorkspaceIndex(await scanWorkspaceGraphs(dir));
    } catch {
      setWorkspaceIndex([]);
    }
  }, []);

  const onNewGraph = useCallback(() => {
    preDragDocumentRef.current = null;
    setDanglingEdgesExportIds(null);
    setGraphDocument(createMinimalGraphDocument());
    historyRef.current = clearHistory(historyRef.current);
    bumpHistoryUi();
    setActiveWorkspaceFile(null);
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
        setGraphOpenError(presentationForReadFailure(t));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        setGraphOpenError(presentationForJsonSyntaxError(t, err));
        return;
      }
      const res = parseGraphDocumentJsonResult(parsed);
      if (!res.ok) {
        setGraphOpenError(presentationForParseError(t, res.error));
        return;
      }
      setActiveWorkspaceFile(null);
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
      await rescanWorkspace(graphs);
    } catch {
      window.alert(t("app.workspace.linkFailed"));
    }
  }, [rescanWorkspace, t]);

  const onOpenWorkspaceGraph = useCallback(
    async (fileName: string) => {
      if (!workspaceGraphsDir) {
        return;
      }
      let text: string;
      try {
        text = await readWorkspaceGraphFile(workspaceGraphsDir, fileName);
      } catch {
        setGraphOpenError(presentationForReadFailure(t));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        setGraphOpenError(presentationForJsonSyntaxError(t, err));
        return;
      }
      const res = parseGraphDocumentJsonResult(parsed);
      if (!res.ok) {
        setGraphOpenError(presentationForParseError(t, res.error));
        return;
      }
      preDragDocumentRef.current = null;
      setDanglingEdgesExportIds(null);
      setGraphDocument(res.doc);
      historyRef.current = clearHistory(historyRef.current);
      bumpHistoryUi();
      setActiveWorkspaceFile(fileName);
      bumpLayoutEpoch();
      setSelection(null);
    },
    [bumpHistoryUi, bumpLayoutEpoch, workspaceGraphsDir, t],
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

  const saveDocumentToWorkspace = useCallback(
    async (doc: GraphDocumentJson, targetFileName: string): Promise<boolean> => {
      if (!workspaceGraphsDir) {
        return false;
      }
      const gid = graphIdFromDocument(doc) ?? "";
      const safeTarget = sanitizeWorkspaceGraphFileName(targetFileName);
      const conflict = findWorkspaceGraphIdConflict(workspaceIndex, gid, safeTarget);
      if (conflict) {
        window.alert(t("app.workspace.duplicateGraphId", { file: conflict }));
        return false;
      }
      try {
        await writeJsonFileToDir(workspaceGraphsDir, safeTarget, doc);
        setGraphDocument(doc);
        setActiveWorkspaceFile(safeTarget);
        await rescanWorkspace(workspaceGraphsDir);
        return true;
      } catch {
        window.alert(t("app.workspace.writeFailed"));
        return false;
      }
    },
    [rescanWorkspace, t, workspaceGraphsDir, workspaceIndex],
  );

  const openSaveModal = useCallback(() => {
    if (getRunSessionSnapshot().activeRunId != null) {
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

  const onRunGraph = useCallback(async () => {
    if (!isTauriRuntime()) {
      return;
    }
    if (structureIssuesBlockRun(structureIssues)) {
      window.alert(t("app.run.fixStructureFirst"));
      return;
    }
    if (pyProbe != null && !pyProbe.ok) {
      window.alert(t("app.run.pythonMissing", { path: pyProbe.path }));
      return;
    }
    const api = canvasRef.current;
    if (!api) {
      return;
    }
    const doc = api.exportDocument();
    const runId = crypto.randomUUID();
    runSessionAppendLine(`[host] starting run ${runId}`);
    runSessionSetActiveRunId(runId);
    try {
      await gcStartRun({
        documentJson: JSON.stringify(doc),
        runId,
        graphsDir: runGraphsDir.trim() || undefined,
        artifactsBase: runArtifactsBase.trim() || undefined,
      });
    } catch (e) {
      runSessionSetActiveRunId(null);
      runSessionAppendLine(`[host] ${String(e)}`);
    }
  }, [
    pyProbe,
    runArtifactsBase,
    runGraphsDir,
    structureIssues.length,
    t,
  ]);

  const onStopRunGraph = useCallback(async () => {
    const id = getRunSessionSnapshot().activeRunId;
    if (!id || !isTauriRuntime()) {
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
    if (isRunActive) {
      return;
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        if (getRunSessionSnapshot().activeRunId != null) {
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
        try {
          await writeJsonFileToDir(workspaceGraphsDir, activeWorkspaceFile, doc);
          setGraphDocument(doc);
        } catch {
          /* ignore transient autosave errors */
        }
      })();
    }, 2000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeWorkspaceFile, graphDocument, layoutDirtyEpoch, workspaceGraphsDir, workspaceIndex, isRunActive]);

  const onApplyNodeData = useCallback((nodeId: string, data: Record<string, unknown>) => {
    const api = canvasRef.current;
    if (!api) {
      return;
    }
    commitHistorySnapshot();
    const doc = api.exportDocument();
    const prevNodes = doc.nodes ?? [];
    const nodes = prevNodes.map((n) => (n.id === nodeId ? { ...n, data: { ...data } } : n));
    setGraphDocument({ ...doc, nodes });
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
  }, [commitHistorySnapshot]);

  const onApplyEdgeCondition = useCallback((edgeId: string, condition: string | null) => {
    const api = canvasRef.current;
    if (!api) {
      return;
    }
    commitHistorySnapshot();
    const doc = api.exportDocument();
    const prevEdges = doc.edges ?? [];
    const edges = prevEdges.map((e) => (e.id === edgeId ? { ...e, condition } : e));
    setGraphDocument({ ...doc, edges });
    setSelection((prev) => {
      if (!prev || prev.kind !== "edge" || prev.id !== edgeId) {
        return prev;
      }
      return { ...prev, condition };
    });
  }, [commitHistorySnapshot]);

  const onConnectNewEdge = useCallback((edge: GraphEdgeJson) => {
    const api = canvasRef.current;
    if (!api) {
      return;
    }
    commitHistorySnapshot();
    const doc = api.exportDocument();
    setGraphDocument({
      ...doc,
      edges: [...(doc.edges ?? []), edge],
    });
  }, [commitHistorySnapshot]);

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
    (pick: AddNodeMenuPick, flowPosition: { x: number; y: number }) => {
      if (getRunSessionSnapshot().activeRunId != null) {
        return;
      }
      const api = canvasRef.current;
      if (!api) {
        return;
      }
      const doc = api.exportDocument();
      const nodes = doc.nodes ?? [];
      if (pick.kind === "primitive") {
        if (pick.nodeType === "start" && nodes.some((n) => n.type === "start")) {
          window.alert(t("app.canvas.onlyOneStart"));
          return;
        }
        const id = newGraphNodeId();
        const data = defaultDataForNodeType(pick.nodeType);
        const parentId =
          pick.nodeType !== GRAPH_NODE_TYPE_COMMENT
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
        setGraphDocument({ ...doc, nodes: [...nodes, newNode] });
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
      setGraphDocument({ ...doc, nodes: [...nodes, newNode] });
    },
    [commitHistorySnapshot, t],
  );

  const runStartDisabled =
    pyProbe != null && !pyProbe.ok;

  const onOpenNestedGraph = useCallback(
    (targetGraphId: string) => {
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
      void onOpenWorkspaceGraph(matches[0].fileName);
    },
    [onOpenWorkspaceGraph, t, workspaceGraphsDir, workspaceIndex],
  );

  useEffect(() => {
    setSelection((sel) => {
      if (!sel) {
        return sel;
      }
      if (sel.kind === "node") {
        if (!(graphDocument.nodes ?? []).some((n) => n.id === sel.id)) {
          return null;
        }
        return sel;
      }
      if (!(graphDocument.edges ?? []).some((e) => e.id === sel.id)) {
        return null;
      }
      return sel;
    });
  }, [graphDocument]);

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
        workspaceLinked={workspaceGraphsDir != null}
        onLinkWorkspace={() => {
          void onLinkWorkspace();
        }}
        workspaceGraphOptions={workspaceGraphOptions}
        onOpenWorkspaceGraph={(name) => {
          void onOpenWorkspaceGraph(name);
        }}
        showRunControls
        runGraphsDir={runGraphsDir}
        runArtifactsBase={runArtifactsBase}
        onRunGraphsDirChange={setRunGraphsDir}
        onRunArtifactsBaseChange={setRunArtifactsBase}
        onRun={() => {
          void onRunGraph();
        }}
        onStopRun={() => {
          void onStopRunGraph();
        }}
        runActive={isRunActive}
        runStartDisabled={runStartDisabled}
        runDesktopOnlyHint={!isTauriRuntime()}
      />
      {branchIssues.length > 0 ||
      structureIssues.length > 0 ||
      handleIssues.length > 0 ||
      (danglingEdgesExportIds != null && danglingEdgesExportIds.length > 0) ? (
        <div className="gc-branch-warnings" role="status">
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
          {structureIssues.map((issue, idx) => (
            <div key={`st-${issue.kind}-${idx}`} className="gc-branch-warnings__line">
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
                    : issue.kind === "merge_few_inputs"
                      ? t("app.structure.mergeFewInputs", {
                          id: issue.nodeId,
                          count: issue.incomingEdges,
                        })
                      : t("app.structure.startHasIncoming", { id: issue.startId })}
            </div>
          ))}
          {handleIssues.map((issue, idx) => (
            <div
              key={`hdl-${issue.kind}-${issue.edgeId}-${idx}`}
              className="gc-branch-warnings__line"
            >
              <span aria-hidden="true">⚠</span>{" "}
              {issue.kind === "invalid_source_handle"
                ? t("app.warnings.invalidSourceHandle", {
                    edgeId: issue.edgeId,
                    nodeId: issue.sourceId,
                    nodeType: issue.sourceType,
                    handle: issue.handle,
                  })
                : t("app.warnings.invalidTargetHandle", {
                    edgeId: issue.edgeId,
                    nodeId: issue.targetId,
                    nodeType: issue.targetType,
                    handle: issue.handle,
                  })}
            </div>
          ))}
          {branchIssues.map((issue, idx) => (
            <div key={`${issue.sourceId}-${issue.handleFanout}-${issue.kind}-${idx}`} className="gc-branch-warnings__line">
              <span aria-hidden="true">⚠</span>{" "}
              {issue.kind === "out_error_unreachable"
                ? t("app.warnings.outErrorUnreachable", { sourceId: issue.sourceId })
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
            </div>
          ))}
        </div>
      ) : null}
      <div className="gc-main-row">
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
              structureLocked={isRunActive}
              runHighlightNodeId={runSession.activeNodeId}
              onNodeDragEnd={() => {
                setLayoutDirtyEpoch((n) => n + 1);
              }}
            />
          </div>
        </div>
        <InspectorPanel
          selection={selection}
          graphDocument={graphDocument}
          onApplyGraphDocumentSettings={onApplyGraphDocumentSettings}
          onApplyNodeData={onApplyNodeData}
          onApplyEdgeCondition={onApplyEdgeCondition}
          workspaceLinked={workspaceGraphsDir != null}
          onOpenNestedGraph={onOpenNestedGraph}
          runLocked={isRunActive}
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
        onClose={() => {
          setSaveModalOpen(false);
        }}
      />
      <OpenGraphErrorModal
        open={graphOpenError != null}
        presentation={graphOpenError}
        onClose={() => {
          setGraphOpenError(null);
        }}
      />
    </div>
  );
}
