// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Folder } from "./types";
import { useWorkflowsStore } from "./workflowsStore";

interface TreeNode {
  folder: Folder;
  children: TreeNode[];
}

function buildTree(folders: Folder[]): TreeNode[] {
  const byParent = new Map<string | null, Folder[]>();
  for (const f of folders) {
    const arr = byParent.get(f.parentId) ?? [];
    arr.push(f);
    byParent.set(f.parentId, arr);
  }
  function walk(parentId: string | null): TreeNode[] {
    const list = byParent.get(parentId) ?? [];
    return list
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((folder) => ({ folder, children: walk(folder.id) }));
  }
  return walk(null);
}

interface FolderTreeProps {
  selectedFolderId: string | null;
  onSelect: (folderId: string | null) => void;
  width?: number;
  onWidthChange?: (next: number) => void;
}

export function FolderTree(props: FolderTreeProps): JSX.Element {
  const { selectedFolderId, onSelect, width = 240, onWidthChange } = props;
  const { t } = useTranslation();
  const folders = useWorkflowsStore((s) => s.folders);
  const addFolder = useWorkflowsStore((s) => s.addFolder);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [newFolderName, setNewFolderName] = useState("");
  const [showInput, setShowInput] = useState(false);
  const tree = useMemo(() => buildTree(folders), [folders]);

  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current || !onWidthChange) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = Math.max(160, Math.min(480, e.clientX - rect.left));
      onWidthChange(next);
    }
    function onUp() {
      draggingRef.current = false;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onWidthChange]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submitNewFolder() {
    const name = newFolderName.trim();
    if (!name) {
      setShowInput(false);
      return;
    }
    addFolder(name, null);
    setNewFolderName("");
    setShowInput(false);
  }

  function renderNode(node: TreeNode, depth: number): JSX.Element {
    const isOpen = expanded.has(node.folder.id);
    const isSelected = selectedFolderId === node.folder.id;
    return (
      <li key={node.folder.id} role="treeitem" aria-expanded={node.children.length > 0 ? isOpen : undefined}>
        <div
          data-testid={`folder-node-${node.folder.id}`}
          onClick={() => toggle(node.folder.id)}
          onDoubleClick={() => onSelect(node.folder.id)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            paddingLeft: 8 + depth * 14,
            paddingTop: 4,
            paddingBottom: 4,
            cursor: "pointer",
            background: isSelected ? "var(--gc-surface-2)" : "transparent",
            color: "var(--gc-text-primary)",
            fontSize: 13,
            userSelect: "none",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 10,
              transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 120ms",
              opacity: node.children.length > 0 ? 1 : 0.25,
            }}
          >
            {"›"}
          </span>
          <span aria-hidden="true">{"📁"}</span>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
            title={node.folder.name}
          >
            {node.folder.name}
          </span>
        </div>
        {isOpen && node.children.length > 0 ? (
          <ul role="group" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {node.children.map((c) => renderNode(c, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="folder-tree"
      style={{
        position: "relative",
        width,
        flexShrink: 0,
        borderRight: "1px solid var(--gc-border)",
        background: "var(--gc-surface-1)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", padding: 8, gap: 6 }}>
        <strong style={{ flex: 1, fontSize: 12, color: "var(--gc-text-secondary)" }}>
          {t("workflows.folders.title")}
        </strong>
        <button
          type="button"
          onClick={() => setShowInput(true)}
          aria-label={t("workflows.folders.newFolder")}
          style={{
            background: "transparent",
            border: "1px solid var(--gc-border)",
            borderRadius: "var(--gc-radius-sm)",
            color: "var(--gc-text-primary)",
            padding: "2px 6px",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          + {t("workflows.folders.newFolder")}
        </button>
      </div>
      {showInput ? (
        <div style={{ padding: 8 }}>
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onBlur={submitNewFolder}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNewFolder();
              if (e.key === "Escape") {
                setNewFolderName("");
                setShowInput(false);
              }
            }}
            placeholder={t("workflows.folders.placeholder")}
            aria-label={t("workflows.folders.placeholder")}
            style={{
              width: "100%",
              padding: "4px 6px",
              border: "1px solid var(--gc-border)",
              borderRadius: "var(--gc-radius-sm)",
              fontSize: 13,
            }}
          />
        </div>
      ) : null}
      <div style={{ flex: 1, overflow: "auto" }}>
        <ul role="tree" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          <li role="treeitem">
            <div
              data-testid="folder-node-root"
              onClick={() => onSelect(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 8px",
                cursor: "pointer",
                background: selectedFolderId === null ? "var(--gc-surface-2)" : "transparent",
                fontSize: 13,
              }}
            >
              <span aria-hidden="true">{"🗂"}</span>
              <span>{t("workflows.folders.allWorkflows")}</span>
            </div>
          </li>
          {tree.map((node) => renderNode(node, 0))}
        </ul>
      </div>
      {onWidthChange ? (
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={() => {
            draggingRef.current = true;
          }}
          style={{
            position: "absolute",
            right: -3,
            top: 0,
            width: 6,
            height: "100%",
            cursor: "col-resize",
          }}
        />
      ) : null}
    </div>
  );
}
