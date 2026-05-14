// Copyright GraphCaster. All Rights Reserved.

import { useState, useCallback, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { useTranslation } from "react-i18next";

import { Dialog } from "../../ui/Dialog/Dialog";
import { InlineExpressionEditor } from "./InlineExpressionEditor";
import type { AvailableNode, AvailableVariable } from "./expressionAutocomplete";
import "./ExpressionEditModal.css";

export interface ExpressionEditModalProps {
  open: boolean;
  onClose: () => void;
  value: string;
  onChange: (newValue: string) => void;
  availableNodes: AvailableNode[];
  availableVariables?: AvailableVariable[];
  resolvedPreview?: string;
  evaluationError?: string;
}

type TreeNode =
  | { kind: "section"; label: string; children: TreeNode[] }
  | { kind: "leaf"; label: string; insert: string };

function buildSidebarTree(
  nodes: AvailableNode[],
  variables: AvailableVariable[],
  labels: { nodes: string; variables: string; special: string },
): TreeNode[] {
  const nodeSection: TreeNode = {
    kind: "section",
    label: labels.nodes,
    children: nodes.map((n) => ({
      kind: "section",
      label: n.id,
      children: n.outputs.map((out) => ({
        kind: "leaf",
        label: out,
        insert: `$node["${n.id}"]["${out}"]`,
      })),
    })),
  };

  const scopeOrder: AvailableVariable["scope"][] = ["sys", "session", "tenant", "env", "run"];
  const byScope = new Map<string, AvailableVariable[]>();
  for (const v of variables) {
    if (!byScope.has(v.scope)) byScope.set(v.scope, []);
    byScope.get(v.scope)!.push(v);
  }
  const variablesSection: TreeNode = {
    kind: "section",
    label: labels.variables,
    children: scopeOrder
      .filter((s) => byScope.has(s))
      .map((s) => ({
        kind: "section",
        label: s,
        children: byScope.get(s)!.map((v) => ({
          kind: "leaf",
          label: v.name,
          insert: `${v.scope}.${v.name}`,
        })),
      })),
  };

  const specialSection: TreeNode = {
    kind: "section",
    label: labels.special,
    children: [
      { kind: "leaf", label: "$now", insert: "$now" },
      { kind: "leaf", label: "$today", insert: "$today" },
      { kind: "leaf", label: "$workflow.id", insert: "$workflow.id" },
      { kind: "leaf", label: "$execution.id", insert: "$execution.id" },
      { kind: "leaf", label: "$input.first()", insert: "$input.first()" },
      { kind: "leaf", label: "$input.last()", insert: "$input.last()" },
      { kind: "leaf", label: "$input.all()", insert: "$input.all()" },
    ],
  };

  return [nodeSection, variablesSection, specialSection];
}

interface SidebarNodeProps {
  node: TreeNode;
  depth: number;
  onLeafClick: (insert: string) => void;
  insertTitle: (insert: string) => string;
}

function SidebarTreeNode({ node, depth, onLeafClick, insertTitle }: SidebarNodeProps) {
  const [expanded, setExpanded] = useState(depth === 0);

  if (node.kind === "leaf") {
    return (
      <button
        className="gc-expr-modal-sidebar__leaf"
        style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
        onClick={() => onLeafClick(node.insert)}
        title={insertTitle(node.insert)}
        type="button"
      >
        {node.label}
      </button>
    );
  }

  return (
    <div className="gc-expr-modal-sidebar__section">
      <button
        className="gc-expr-modal-sidebar__section-header"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        type="button"
      >
        <span className="gc-expr-modal-sidebar__chevron">{expanded ? "▾" : "▸"}</span>
        {node.label}
      </button>
      {expanded && (
        <div className="gc-expr-modal-sidebar__children">
          {node.children.map((child, idx) => (
            <SidebarTreeNode
              key={`${child.label}-${idx}`}
              node={child}
              depth={depth + 1}
              onLeafClick={onLeafClick}
              insertTitle={insertTitle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ExpressionEditModal({
  open,
  onClose,
  value,
  onChange,
  availableNodes,
  availableVariables = [],
  resolvedPreview,
  evaluationError,
}: ExpressionEditModalProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const editorViewRef = useRef<EditorView | null>(null);

  const sidebarTree = buildSidebarTree(availableNodes, availableVariables, {
    nodes: t("app.expressionEditor.sectionNodes"),
    variables: t("app.expressionEditor.sectionVariables"),
    special: t("app.expressionEditor.sectionSpecial"),
  });

  const handleLeafClick = useCallback((insert: string) => {
    const view = editorViewRef.current;
    if (view) {
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
      });
      view.focus();
    } else {
      // Fallback: append to draft
      setDraft((d) => d + insert);
    }
  }, []);

  const handleSave = useCallback(() => {
    onChange(draft);
    onClose();
  }, [draft, onChange, onClose]);

  const handleClose = useCallback(() => {
    setDraft(value);
    onClose();
  }, [value, onClose]);

  // Reset draft when value changes externally (modal re-opened)
  const prevOpen = useRef(open);
  if (open && !prevOpen.current) {
    setDraft(value);
  }
  prevOpen.current = open;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o) handleClose(); }}
      size="2xlarge"
      title={t("app.expressionEditor.title")}
      showCloseButton
      footer={
        <div className="gc-expr-modal-footer">
          <button type="button" className="gc-expr-modal-footer__cancel" onClick={handleClose}>
            {t("app.expressionEditor.cancel")}
          </button>
          <button type="button" className="gc-expr-modal-footer__save" onClick={handleSave}>
            {t("app.expressionEditor.save")}
          </button>
        </div>
      }
    >
      <div className="gc-expr-modal-body">
        <aside className="gc-expr-modal-sidebar" aria-label={t("app.expressionEditor.sidebarAria")}>
          {sidebarTree.map((node, idx) => (
            <SidebarTreeNode
              key={`${node.label}-${idx}`}
              node={node}
              depth={0}
              onLeafClick={handleLeafClick}
              insertTitle={(insert) => t("app.expressionEditor.insertTitle", { insert })}
            />
          ))}
        </aside>

        <div className="gc-expr-modal-main">
          <div className="gc-expr-modal-editor-wrap">
            <InlineExpressionEditor
              value={draft}
              onChange={setDraft}
              availableNodes={availableNodes}
              availableVariables={availableVariables}
              multiline
              height={280}
              editorViewRef={editorViewRef}
            />
          </div>

          {evaluationError ? (
            <div className="gc-expr-modal-error" role="alert" data-testid="eval-error">
              {evaluationError}
            </div>
          ) : resolvedPreview !== undefined ? (
            <div className="gc-expr-modal-preview" data-testid="modal-preview">
              <span className="gc-expr-modal-preview__label">{t("app.expressionEditor.previewLabel")}</span>
              <span className="gc-expr-modal-preview__value">{resolvedPreview}</span>
            </div>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
