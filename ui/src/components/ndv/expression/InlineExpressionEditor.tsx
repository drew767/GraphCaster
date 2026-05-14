// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useRef, useCallback, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import { EditorView, keymap, tooltips } from "@codemirror/view";
import { EditorState, Transaction } from "@codemirror/state";
import { defaultKeymap, historyKeymap, history } from "@codemirror/commands";
import { hoverTooltip } from "@codemirror/view";
import { autocompletion } from "@codemirror/autocomplete";

import { expressionHighlight, expressionHighlightTheme } from "./expressionHighlight";
import { buildExpressionAutocomplete, type AvailableNode, type AvailableVariable } from "./expressionAutocomplete";
import { createExpressionCompletion } from "./completion";
import { buildResolveHoverTooltip } from "./hoverTooltip";
import type { EvaluationContext } from "./evaluator";
import "./InlineExpressionEditor.css";

export interface InlineExpressionEditorProps {
  value: string;
  onChange: (newValue: string) => void;
  availableNodes: AvailableNode[];
  availableVariables?: AvailableVariable[];
  placeholder?: string;
  multiline?: boolean;
  height?: number;
  language?: "expression" | "json" | "javascript";
  className?: string;
  readOnly?: boolean;
  resolvedPreview?: string;
  editorViewRef?: MutableRefObject<EditorView | null>;
  /** Optional evaluation context used by the hover-resolve tooltip. */
  evaluationContext?: EvaluationContext;
}

const VARIABLE_DOCS: Record<string, string> = {
  $now: "Current datetime as ISO string",
  $today: "Current date as ISO date string",
  $workflow: "Workflow metadata object",
  $execution: "Execution metadata object",
  $input: "Input data helper with .first(), .last(), .all()",
  $json: "JSON data of the current item",
  $node: "Reference an upstream node by name",
};

function buildHoverTooltip() {
  return hoverTooltip((view, pos) => {
    const text = view.state.doc.toString();
    // Find the word under cursor
    let start = pos;
    let end = pos;
    while (start > 0 && /[\w$.]/.test(text[start - 1])) start--;
    while (end < text.length && /[\w$.]/.test(text[end])) end++;
    const word = text.slice(start, end);
    if (!word.startsWith("$")) return null;

    // Match base variable name
    const base = word.match(/^(\$[a-zA-Z_][\w]*)/)?.[1];
    if (!base) return null;
    const doc = VARIABLE_DOCS[base];
    if (!doc) return null;

    return {
      pos: start,
      end,
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.className = "gc-expr-tooltip";
        dom.textContent = `${base}: ${doc}`;
        return { dom };
      },
    };
  });
}

function singleLineExtension() {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;
    // Reject transactions that would introduce newlines
    let hasNewline = false;
    tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
      if (inserted.toString().includes("\n")) {
        hasNewline = true;
      }
    });
    if (hasNewline) return [] as Transaction[];
    return tr;
  });
}

export function InlineExpressionEditor({
  value,
  onChange,
  availableNodes,
  availableVariables = [],
  placeholder,
  multiline = false,
  height,
  className,
  readOnly = false,
  resolvedPreview,
  editorViewRef,
  evaluationContext,
}: InlineExpressionEditorProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const evaluationContextRef = useRef<EvaluationContext | undefined>(evaluationContext);
  evaluationContextRef.current = evaluationContext;

  const initEditor = useCallback(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const extensions = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      expressionHighlight,
      expressionHighlightTheme,
      buildExpressionAutocomplete({ availableNodes, availableVariables }),
      autocompletion({
        override: [
          createExpressionCompletion({
            getNodeNames: () => availableNodes.map((n) => n.id),
          }),
        ],
        closeOnBlur: false,
      }),
      buildHoverTooltip(),
      buildResolveHoverTooltip({
        getContext: () => evaluationContextRef.current ?? {},
      }),
      tooltips({ position: "absolute" }),
      updateListener,
      EditorView.lineWrapping,
    ];

    if (!multiline) {
      extensions.push(singleLineExtension());
    }

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true));
    }

    if (height !== undefined) {
      extensions.push(EditorView.theme({ "&": { height: `${height}px` } }));
    }

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;
    if (editorViewRef) {
      editorViewRef.current = view;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    initEditor();
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync external value changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  const wrapClass = ["gc-inline-expr", className].filter(Boolean).join(" ");

  return (
    <div className={wrapClass} data-testid="inline-expression-editor">
      <div
        ref={containerRef}
        className="gc-inline-expr__editor"
        data-placeholder={placeholder}
        aria-label={placeholder}
      />
      {resolvedPreview !== undefined && (
        <div className="gc-inline-expr__preview" data-testid="expression-preview">
          <span className="gc-inline-expr__preview-label">{t("app.expressionEditor.previewLabel")}</span>
          <span className="gc-inline-expr__preview-value">{resolvedPreview}</span>
        </div>
      )}
    </div>
  );
}
