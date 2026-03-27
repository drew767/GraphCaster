// Copyright Aura. All Rights Reserved.

import exampleDocument from "@schemas/graph-document.example.json";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";

import type { GraphCanvasHandle, GraphCanvasSelection } from "../components/GraphCanvas";
import { GraphCanvas } from "../components/GraphCanvas";
import { ConsolePanel } from "../components/ConsolePanel";
import { InspectorPanel } from "../components/InspectorPanel";
import { TopBar } from "../components/TopBar";
import { createMinimalGraphDocument } from "../graph/documentFactory";
import type { GraphDocumentJson, GraphEdgeJson } from "../graph/types";
import { findBranchAmbiguities } from "../graph/branchWarnings";
import {
  defaultDataForNodeType,
  newGraphNodeId,
  type PaletteNodeType,
} from "../graph/nodePalette";
import { graphIdFromDocument, parseGraphDocumentJson } from "../graph/parseDocument";
import { findStructureIssues } from "../graph/structureWarnings";
import { nodeLabel } from "../graph/toReactFlow";
import { downloadJsonFile, safeGraphDownloadBasename } from "../lib/downloadJson";
import {
  defaultWorkspaceFileName,
  ensureGraphsDirectory,
  findWorkspaceGraphIdConflict,
  pickProjectRootDirectory,
  readWorkspaceGraphFile,
  scanWorkspaceGraphs,
  supportsFileSystemAccess,
  writeJsonFileToDir,
  type WorkspaceGraphEntry,
} from "../lib/workspaceFs";
import { useConsoleHeight } from "../hooks/useConsoleHeight";

type Props = {
  onLangChange: (lng: string) => void;
};

export function AppShell({ onLangChange }: Props) {
  const { t } = useTranslation();
  const { height, startDrag } = useConsoleHeight(168);
  const [selection, setSelection] = useState<GraphCanvasSelection | null>(null);
  const [graphDocument, setGraphDocument] = useState<GraphDocumentJson>(() => {
    const parsed = parseGraphDocumentJson(exampleDocument as unknown);
    return parsed ?? createMinimalGraphDocument();
  });
  const branchIssues = useMemo(() => findBranchAmbiguities(graphDocument), [graphDocument]);
  const structureIssues = useMemo(() => findStructureIssues(graphDocument), [graphDocument]);

  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const [workspaceGraphsDir, setWorkspaceGraphsDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [workspaceIndex, setWorkspaceIndex] = useState<WorkspaceGraphEntry[]>([]);
  const [activeWorkspaceFile, setActiveWorkspaceFile] = useState<string | null>(null);
  const [layoutDirtyEpoch, setLayoutDirtyEpoch] = useState(0);
  const canvasRef = useRef<GraphCanvasHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setGraphDocument(createMinimalGraphDocument());
    setActiveWorkspaceFile(null);
    bumpLayoutEpoch();
    setSelection(null);
  }, [bumpLayoutEpoch]);

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
      try {
        const text = await file.text();
        const parsed: unknown = JSON.parse(text);
        const doc = parseGraphDocumentJson(parsed);
        if (!doc) {
          window.alert(t("app.errors.invalidGraphJson"));
          return;
        }
        setActiveWorkspaceFile(null);
        setGraphDocument(doc);
        bumpLayoutEpoch();
        setSelection(null);
      } catch {
        window.alert(t("app.errors.readJsonFailed"));
      }
    },
    [bumpLayoutEpoch, t],
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
      try {
        const text = await readWorkspaceGraphFile(workspaceGraphsDir, fileName);
        const parsed: unknown = JSON.parse(text);
        const doc = parseGraphDocumentJson(parsed);
        if (!doc) {
          window.alert(t("app.errors.invalidGraphJson"));
          return;
        }
        setGraphDocument(doc);
        setActiveWorkspaceFile(fileName);
        bumpLayoutEpoch();
        setSelection(null);
      } catch {
        window.alert(t("app.errors.readJsonFailed"));
      }
    },
    [bumpLayoutEpoch, workspaceGraphsDir, t],
  );

  const workspaceGraphOptions = useMemo(
    () =>
      workspaceIndex.map((e) => ({
        fileName: e.fileName,
        label: e.duplicateGraphId
          ? `${e.fileName} ⚠ ${e.graphId}`
          : e.title
            ? `${e.fileName} — ${e.title}`
            : e.fileName,
      })),
    [workspaceIndex],
  );

  const persistToWorkspace = useCallback(async (): Promise<boolean> => {
    if (!workspaceGraphsDir || !canvasRef.current) {
      return false;
    }
    const doc = canvasRef.current.exportDocument();
    const gid = graphIdFromDocument(doc) ?? "";
    const targetName = activeWorkspaceFile ?? defaultWorkspaceFileName(doc);
    const conflict = findWorkspaceGraphIdConflict(workspaceIndex, gid, activeWorkspaceFile);
    if (conflict) {
      window.alert(t("app.workspace.duplicateGraphId", { file: conflict }));
      return false;
    }
    try {
      await writeJsonFileToDir(workspaceGraphsDir, targetName, doc);
      setGraphDocument(doc);
      setActiveWorkspaceFile(targetName);
      await rescanWorkspace(workspaceGraphsDir);
      return true;
    } catch {
      window.alert(t("app.workspace.writeFailed"));
      return false;
    }
  }, [activeWorkspaceFile, rescanWorkspace, t, workspaceGraphsDir, workspaceIndex]);

  const onSaveGraph = useCallback(() => {
    void (async () => {
      const api = canvasRef.current;
      if (!api) {
        return;
      }
      if (workspaceGraphsDir) {
        await persistToWorkspace();
      } else {
        const doc = api.exportDocument();
        downloadJsonFile(safeGraphDownloadBasename(graphIdFromDocument(doc) ?? "graph"), doc);
      }
    })();
  }, [persistToWorkspace, workspaceGraphsDir]);

  useEffect(() => {
    if (!workspaceGraphsDir || !activeWorkspaceFile) {
      return;
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        const api = canvasRef.current;
        if (!api || !workspaceGraphsDir) {
          return;
        }
        const doc = api.exportDocument();
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
  }, [activeWorkspaceFile, graphDocument, layoutDirtyEpoch, workspaceGraphsDir, workspaceIndex]);

  const onApplyNodeData = useCallback((nodeId: string, data: Record<string, unknown>) => {
    const api = canvasRef.current;
    if (!api) {
      return;
    }
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
  }, []);

  const onApplyEdgeCondition = useCallback((edgeId: string, condition: string | null) => {
    const api = canvasRef.current;
    if (!api) {
      return;
    }
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
  }, []);

  const onConnectNewEdge = useCallback((edge: GraphEdgeJson) => {
    const api = canvasRef.current;
    if (!api) {
      return;
    }
    const doc = api.exportDocument();
    setGraphDocument({
      ...doc,
      edges: [...(doc.edges ?? []), edge],
    });
  }, []);

  const onFlowStructureChange = useCallback(() => {
    const api = canvasRef.current;
    if (!api) {
      return;
    }
    setGraphDocument(api.exportDocument());
  }, []);

  const onAddNode = useCallback(
    (nodeType: PaletteNodeType, flowPosition: { x: number; y: number }) => {
      const api = canvasRef.current;
      if (!api) {
        return;
      }
      const doc = api.exportDocument();
      const nodes = doc.nodes ?? [];
      if (nodeType === "start" && nodes.some((n) => n.type === "start")) {
        window.alert(t("app.canvas.onlyOneStart"));
        return;
      }
      const id = newGraphNodeId();
      const data = defaultDataForNodeType(nodeType);
      const newNode = {
        id,
        type: nodeType,
        position: { x: flowPosition.x, y: flowPosition.y },
        data,
      };
      setGraphDocument({ ...doc, nodes: [...nodes, newNode] });
    },
    [t],
  );

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
    <div className="app-root">
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
        workspaceLinked={workspaceGraphsDir != null}
        onLinkWorkspace={() => {
          void onLinkWorkspace();
        }}
        workspaceGraphOptions={workspaceGraphOptions}
        onOpenWorkspaceGraph={(name) => {
          void onOpenWorkspaceGraph(name);
        }}
      />
      {branchIssues.length > 0 || structureIssues.length > 0 ? (
        <div className="gc-branch-warnings" role="status">
          {structureIssues.map((issue, idx) => (
            <div key={`st-${issue.kind}-${idx}`} className="gc-branch-warnings__line">
              <span aria-hidden="true">⚠</span>{" "}
              {issue.kind === "no_start"
                ? t("app.structure.noStart")
                : issue.kind === "multiple_starts"
                  ? t("app.structure.multipleStarts", { ids: issue.ids.join(", ") })
                  : t("app.structure.startHasIncoming", { id: issue.startId })}
            </div>
          ))}
          {branchIssues.map((issue, idx) => (
            <div key={`${issue.sourceId}-${issue.kind}-${idx}`} className="gc-branch-warnings__line">
              <span aria-hidden="true">⚠</span>{" "}
              {issue.kind === "multiple_unconditional"
                ? t("app.warnings.multipleUnconditional", { sourceId: issue.sourceId })
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
              onAddNode={onAddNode}
              onConnectNewEdge={onConnectNewEdge}
              onFlowStructureChange={onFlowStructureChange}
              onNodeDragEnd={() => {
                setLayoutDirtyEpoch((n) => n + 1);
              }}
            />
          </div>
        </div>
        <InspectorPanel
          selection={selection}
          onApplyNodeData={onApplyNodeData}
          onApplyEdgeCondition={onApplyEdgeCondition}
          workspaceLinked={workspaceGraphsDir != null}
          onOpenNestedGraph={onOpenNestedGraph}
        />
      </div>
      <ConsolePanel heightPx={height} onResizeStart={startDrag} />
    </div>
  );
}
