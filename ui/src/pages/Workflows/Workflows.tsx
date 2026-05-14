// Copyright GraphCaster. All Rights Reserved.

import React, { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { Button, Heading } from "../../components/ui";
import { Breadcrumbs, type BreadcrumbItem } from "../../components/ui/Breadcrumbs/Breadcrumbs";
import { Switch } from "../../components/ui/Switch/Switch";
import { EmptyState } from "../../components/ui/EmptyState/EmptyState";
import { SkeletonCard } from "../../components/ui/Skeleton/Skeleton";
import { BulkActionsBar, type BulkAction } from "../../components/ui/BulkActionsBar/BulkActionsBar";
import { WorkflowCard, type WorkflowCardData } from "./WorkflowCard";
import { FolderCard } from "./FolderCard";
import { useListNav } from "../../lib/hooks/useListNav";

// ---------------------------------------------------------------------------
// Stub types & data hook — replaced when UX41 hooks land
// ---------------------------------------------------------------------------

interface WorkflowSummary {
  id: string;
  name: string;
  active: boolean;
  updatedAt: string;
}

function useWorkflowsList(): {
  workflows: WorkflowSummary[];
  loading: boolean;
} {
  return { workflows: [], loading: false };
}

// ---------------------------------------------------------------------------
// Folder helpers
// ---------------------------------------------------------------------------

interface FolderNode {
  path: string;
  name: string;
  workflowCount: number;
  subFolderCount: number;
}

function encodeFolderPath(segments: string[]): string {
  return segments.join("/");
}

function parseFolderPath(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split("/").filter(Boolean);
}

function getFolderChildren(
  workflows: WorkflowCardData[],
  currentPath: string[],
): { folders: FolderNode[]; workflows: WorkflowCardData[] } {
  const prefix =
    currentPath.length > 0 ? encodeFolderPath(currentPath) + "/" : "";

  const directWorkflows: WorkflowCardData[] = [];
  const subFolderMap = new Map<
    string,
    { wfCount: number; subCount: Set<string> }
  >();

  for (const wf of workflows) {
    const wfFolder = wf.folder ?? "";

    if (currentPath.length === 0) {
      if (!wfFolder) {
        directWorkflows.push(wf);
      } else {
        const topSegment = wfFolder.split("/")[0];
        if (!subFolderMap.has(topSegment)) {
          subFolderMap.set(topSegment, { wfCount: 0, subCount: new Set() });
        }
        const entry = subFolderMap.get(topSegment)!;
        const restSegments = wfFolder.split("/").slice(1);
        if (restSegments.length === 0) {
          entry.wfCount += 1;
        } else {
          entry.subCount.add(restSegments[0]);
        }
      }
    } else {
      if (wfFolder === encodeFolderPath(currentPath)) {
        directWorkflows.push(wf);
      } else if (wfFolder.startsWith(prefix)) {
        const rest = wfFolder.slice(prefix.length);
        const nextSegment = rest.split("/")[0];
        if (!subFolderMap.has(nextSegment)) {
          subFolderMap.set(nextSegment, { wfCount: 0, subCount: new Set() });
        }
        const entry = subFolderMap.get(nextSegment)!;
        const deeper = rest.split("/").slice(1);
        if (deeper.length === 0) {
          entry.wfCount += 1;
        } else {
          entry.subCount.add(deeper[0]);
        }
      }
    }
  }

  const folders: FolderNode[] = Array.from(subFolderMap.entries()).map(
    ([name, { wfCount, subCount }]) => ({
      path: prefix + name,
      name,
      workflowCount: wfCount,
      subFolderCount: subCount.size,
    }),
  );

  return { folders, workflows: directWorkflows };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function WorkflowsView() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Folder path comes from the wildcard route segment
  const params = useParams<{ "*": string }>();
  const folderSegments = parseFolderPath(params["*"]);

  const { loading } = useWorkflowsList();

  // Local workflow state — in production this would be managed by a real store/hook
  const [richWorkflows, setRichWorkflows] = useState<WorkflowCardData[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const visibleWorkflows = useMemo(
    () => (showArchived ? richWorkflows : richWorkflows.filter((w) => !w.archived)),
    [richWorkflows, showArchived],
  );

  const { folders, workflows: pageWorkflows } = useMemo(
    () => getFolderChildren(visibleWorkflows, folderSegments),
    [visibleWorkflows, folderSegments],
  );

  const availableTags = useMemo(
    () => Array.from(new Set(richWorkflows.flatMap((w) => w.tags))).sort(),
    [richWorkflows],
  );

  // ---------------------------------------------------------------------------
  // Breadcrumbs
  // ---------------------------------------------------------------------------

  const breadcrumbItems: BreadcrumbItem[] = useMemo(() => {
    const items: BreadcrumbItem[] = [
      {
        label: t("app.sidebar.workflows", "Workflows"),
        onClick: () => navigate("/home/workflows"),
      },
    ];
    folderSegments.forEach((seg, idx) => {
      const targetPath = folderSegments.slice(0, idx + 1).join("/");
      items.push({
        label: seg,
        onClick:
          idx < folderSegments.length - 1
            ? () => navigate(`/home/workflows/folder/${targetPath}`)
            : undefined,
      });
    });
    return items;
  }, [folderSegments, navigate, t]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleToggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleClearSelection() {
    setSelected(new Set());
  }

  const handleArchive = useCallback((id: string) => {
    setRichWorkflows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, archived: true } : w)),
    );
  }, []);

  const handleRestore = useCallback((id: string) => {
    setRichWorkflows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, archived: false } : w)),
    );
  }, []);

  const handleTagsChange = useCallback((id: string, tags: string[]) => {
    setRichWorkflows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, tags } : w)),
    );
  }, []);

  const handleNavigateFolder = useCallback(
    (path: string) => {
      navigate(`/home/workflows/folder/${path}`);
    },
    [navigate],
  );

  const handleFolderRename = useCallback(
    (folderName: string, newName: string) => {
      const oldPrefix =
        folderSegments.length > 0
          ? `${encodeFolderPath(folderSegments)}/${folderName}`
          : folderName;
      const newPrefix =
        folderSegments.length > 0
          ? `${encodeFolderPath(folderSegments)}/${newName}`
          : newName;
      setRichWorkflows((prev) =>
        prev.map((w) => {
          if (!w.folder) return w;
          if (
            w.folder === oldPrefix ||
            w.folder.startsWith(oldPrefix + "/")
          ) {
            return { ...w, folder: w.folder.replace(oldPrefix, newPrefix) };
          }
          return w;
        }),
      );
    },
    [folderSegments],
  );

  const bulkActions: BulkAction[] = [
    {
      id: "archive",
      label: t("app.workflows.archive.archive", "Archive"),
      icon: "archive",
      onClick: () => {
        setRichWorkflows((prev) =>
          prev.map((w) => (selected.has(w.id) ? { ...w, archived: true } : w)),
        );
        setSelected(new Set());
      },
    },
    {
      id: "delete",
      label: t("app.workflows.bulkDelete", "Delete"),
      icon: "trash-2",
      destructive: true,
      onClick: () => {
        setSelected(new Set());
      },
    },
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="gc-workflows-page">
      <div className="gc-workflows-page__header">
        <div className="gc-workflows-page__title-row">
          {folderSegments.length > 0 ? (
            <Breadcrumbs items={breadcrumbItems} />
          ) : (
            <Heading level={1} size="xl">
              {t("app.sidebar.workflows", "Workflows")}
            </Heading>
          )}
        </div>

        <div className="gc-workflows-page__actions">
          <Switch
            checked={showArchived}
            onCheckedChange={setShowArchived}
            label={t("app.workflows.archive.showArchived", "Show archived")}
          />
          <Button
            variant="ghost"
            size="small"
            iconLeft="folder-plus"
            onClick={() => {
              const name = window.prompt(
                t("app.workflows.folder.newFolderPrompt", "Folder name"),
              );
              if (!name?.trim()) return;
              const newPath =
                folderSegments.length > 0
                  ? `${encodeFolderPath(folderSegments)}/${name.trim()}`
                  : name.trim();
              setRichWorkflows((prev) => [
                ...prev,
                {
                  id: `placeholder-${Date.now()}`,
                  name: t(
                    "app.workflows.folder.placeholderWorkflow",
                    "New workflow",
                  ),
                  tags: [],
                  active: false,
                  archived: false,
                  updatedAt: new Date().toISOString(),
                  folder: newPath,
                },
              ]);
            }}
          >
            {t("app.workflows.folder.newFolder", "+ New folder")}
          </Button>
          <Button
            variant="solid"
            size="small"
            iconLeft="plus"
            onClick={() => navigate("/workflow/new")}
          >
            {t("app.home.createNew", "New workflow")}
          </Button>
        </div>
      </div>

      <BulkActionsBar
        selectedCount={selected.size}
        totalCount={richWorkflows.length}
        actions={bulkActions}
        onClearSelection={handleClearSelection}
      />

      {loading ? (
        <div className="gc-workflows-page__skeleton-grid">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <div className="gc-workflows-page__grid">
          {folders.map((folder) => (
            <FolderCard
              key={folder.path}
              path={folder.path}
              name={folder.name}
              workflowCount={folder.workflowCount}
              subFolderCount={folder.subFolderCount}
              onClick={() => handleNavigateFolder(folder.path)}
              onRename={(newName) => handleFolderRename(folder.name, newName)}
            />
          ))}

          <WorkflowList
            items={pageWorkflows}
            availableTags={availableTags}
            onTagsChange={handleTagsChange}
            onArchive={handleArchive}
            onRestore={handleRestore}
            onOpen={(id) => navigate(`/workflow/${id}`)}
          />


          {folders.length === 0 && pageWorkflows.length === 0 && (
            <EmptyState
              icon="workflow"
              title={t("app.empty.workflows.title")}
              description={t("app.empty.workflows.description")}
              action={{
                label: t("app.empty.workflows.action"),
                onClick: () => navigate("/workflow/new"),
              }}
              secondaryAction={{
                label: t("app.empty.workflows.secondary"),
                href: "/templates",
              }}
              size="large"
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkflowList — applies keyboard navigation across cards
// ---------------------------------------------------------------------------

interface WorkflowListProps {
  items: WorkflowCardData[];
  availableTags: string[];
  onTagsChange: (id: string, tags: string[]) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onOpen: (id: string) => void;
}

function WorkflowList({
  items,
  availableTags,
  onTagsChange,
  onArchive,
  onRestore,
  onOpen,
}: WorkflowListProps) {
  const cardRefs = React.useRef<Array<HTMLDivElement | null>>([]);

  const { focusedIndex, getItemProps } = useListNav<WorkflowCardData>(
    items,
    (wf) => onOpen(wf.id),
  );

  React.useEffect(() => {
    if (items.length === 0) return;
    const el = cardRefs.current[focusedIndex];
    if (el && document.activeElement !== el) {
      // Only steal focus if the focused element is outside the list to avoid
      // disrupting interactions with inner controls (tag editor, menus).
      const within = el.contains(document.activeElement);
      if (!within && document.activeElement === document.body) {
        el.focus();
      }
    }
  }, [focusedIndex, items.length]);

  return (
    <>
      {items.map((wf, idx) => {
        const props = getItemProps(idx);
        return (
          <WorkflowCard
            key={wf.id}
            ref={(el) => {
              cardRefs.current[idx] = el;
            }}
            workflow={wf}
            availableTags={availableTags}
            onTagsChange={onTagsChange}
            onArchive={onArchive}
            onRestore={onRestore}
            onOpen={onOpen}
            tabIndex={props.tabIndex}
            ariaSelected={props["aria-selected"]}
            focused={idx === focusedIndex}
            onFocus={props.onFocus}
            onKeyDown={props.onKeyDown}
          />
        );
      })}
    </>
  );
}
