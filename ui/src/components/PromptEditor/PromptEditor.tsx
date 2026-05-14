// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useRef } from "react";
import type { BeforeMount, OnMount } from "@monaco-editor/react";
import Editor from "@monaco-editor/react";
import type * as MonacoNs from "monaco-editor";

import { useTranslation } from "react-i18next";
import { VariablePicker, type UpstreamNodeDef, type VariableDef } from "./VariablePicker";

export type PromptEditorProps = {
  value: string;
  onChange: (text: string) => void;
  availableNodes: Array<{ id: string; type: string; outputs: string[] }>;
  availableVariables?: Array<{ scope: "sys" | "session" | "tenant" | "env"; name: string }>;
  language?: "markdown" | "plaintext";
  height?: number;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
};

const PROMPT_LANG_ID = "gc-prompt-template";
let langRegistered = false;
let completionProviderRegistered = false;

/**
 * Register the custom language for prompt templates once.
 * Highlights {{ }} braces and their inner content differently.
 */
function registerPromptLanguage(monaco: typeof MonacoNs): void {
  if (langRegistered) {
    return;
  }
  langRegistered = true;
  monaco.languages.register({ id: PROMPT_LANG_ID });
  monaco.languages.setMonarchTokensProvider(PROMPT_LANG_ID, {
    tokenizer: {
      root: [
        [/\{\{/, { token: "gc-prompt-brace", next: "@inside" }],
        [/[^{]+/, "gc-prompt-text"],
        [/\{/, "gc-prompt-text"],
      ],
      inside: [
        [/\}\}/, { token: "gc-prompt-brace", next: "@pop" }],
        [/\$node\.[a-zA-Z0-9_.-]+/, "gc-prompt-node-ref"],
        [/\$(json|node|env)\b/, "gc-prompt-builtin"],
        [/(sys|session|tenant|env)\.[a-zA-Z0-9_.]+/, "gc-prompt-scope-ref"],
        [/[a-zA-Z_][\w.]*/, "gc-prompt-ident"],
        [/./, "gc-prompt-inner"],
      ],
    },
  });
  monaco.editor.defineTheme("gc-prompt-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "gc-prompt-text", foreground: "1e1e1e" },
      { token: "gc-prompt-brace", foreground: "0070c1", fontStyle: "bold" },
      { token: "gc-prompt-node-ref", foreground: "267f99" },
      { token: "gc-prompt-builtin", foreground: "267f99", fontStyle: "bold" },
      { token: "gc-prompt-scope-ref", foreground: "811f3f" },
      { token: "gc-prompt-ident", foreground: "795e26" },
      { token: "gc-prompt-inner", foreground: "795e26" },
    ],
    colors: {},
  });
}

/**
 * Register the autocomplete provider for {{ ... }} prompt expressions.
 * Triggers on `{` so users get suggestions when they type `{{`.
 */
function registerCompletionProvider(
  monaco: typeof MonacoNs,
  getNodes: () => UpstreamNodeDef[],
  getVars: () => VariableDef[],
): void {
  if (completionProviderRegistered) {
    completionProviderRegistered = true;
    return;
  }
  completionProviderRegistered = true;
  monaco.languages.registerCompletionItemProvider(PROMPT_LANG_ID, {
    triggerCharacters: ["{", " ", "."],
    provideCompletionItems(model, position) {
      const lineText = model.getLineContent(position.lineNumber);
      const colBefore = lineText.slice(0, position.column - 1);

      // Only suggest inside {{ ... }}
      const lastOpen = colBefore.lastIndexOf("{{");
      const lastClose = colBefore.lastIndexOf("}}");
      const insideMustache = lastOpen > lastClose;
      if (!insideMustache) {
        return { suggestions: [] };
      }

      const innerText = colBefore.slice(lastOpen + 2).trimStart();
      const range: MonacoNs.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: position.column,
        endColumn: position.column,
      };

      const suggestions: MonacoNs.languages.CompletionItem[] = [];

      // $node suggestions
      if (innerText === "" || innerText.startsWith("$")) {
        const nodes = getNodes();
        for (const node of nodes) {
          for (const output of node.outputs) {
            const expr = `$node.${node.id}.${output}`;
            suggestions.push({
              label: expr,
              kind: monaco.languages.CompletionItemKind.Variable,
              insertText: `$node.${node.id}.${output} }}`,
              detail: node.type,
              documentation: `Output '${output}' from node '${node.id}' (${node.type})`,
              range,
            });
          }
        }
        // $json
        suggestions.push({
          label: "$json",
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: "$json }}",
          detail: "predecessor output",
          range,
        });
      }

      // sys.* / session.* / tenant.* / env.* suggestions
      if (innerText === "" || /^(sys|session|tenant|env)/.test(innerText)) {
        const vars = getVars();
        for (const v of vars) {
          const expr = `${v.scope}.${v.name}`;
          suggestions.push({
            label: expr,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: `${expr} }}`,
            detail: v.scope,
            range,
          });
        }
        // Built-in sys variables
        for (const sysVar of ["sys.run_id", "sys.graph_id", "sys.node_id"]) {
          suggestions.push({
            label: sysVar,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: `${sysVar} }}`,
            detail: "sys",
            range,
          });
        }
      }

      return { suggestions };
    },
  });
}

const beforeMount: BeforeMount = (monaco) => {
  registerPromptLanguage(monaco);
};

export function PromptEditor({
  value,
  onChange,
  availableNodes,
  availableVariables = [],
  language = "plaintext",
  height = 160,
  placeholder,
  readOnly = false,
  disabled = false,
}: PromptEditorProps) {
  const { t } = useTranslation();
  const editorRef = useRef<MonacoNs.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof MonacoNs | null>(null);
  const availableNodesRef = useRef<UpstreamNodeDef[]>(availableNodes);
  const availableVariablesRef = useRef<VariableDef[]>(availableVariables);

  useEffect(() => {
    availableNodesRef.current = availableNodes;
  }, [availableNodes]);

  useEffect(() => {
    availableVariablesRef.current = availableVariables;
  }, [availableVariables]);

  const ro = readOnly || disabled;

  const onMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      registerCompletionProvider(
        monaco,
        () => availableNodesRef.current,
        () => availableVariablesRef.current,
      );

      // Hover provider: show resolved expression info
      monaco.languages.registerHoverProvider(PROMPT_LANG_ID, {
        provideHover(model, position) {
          const wordAtPos = model.getWordAtPosition(position);
          const lineText = model.getLineContent(position.lineNumber);
          // Find surrounding {{ ... }} for hover
          const col = position.column - 1;
          const lastOpen = lineText.lastIndexOf("{{", col);
          const nextClose = lineText.indexOf("}}", col);
          if (lastOpen < 0 || nextClose < 0) {
            return null;
          }
          const expr = lineText.slice(lastOpen + 2, nextClose).trim();
          if (!expr) {
            return null;
          }

          // $node.<id>.<output> — show type info
          const nodeMatch = expr.match(/^\$node\.([^.]+)\.(.+)$/);
          if (nodeMatch) {
            const nodeId = nodeMatch[1];
            const output = nodeMatch[2];
            const node = availableNodesRef.current.find((n) => n.id === nodeId);
            const typeInfo = node ? ` (${node.type})` : "";
            return {
              range: new monaco.Range(
                position.lineNumber,
                lastOpen + 1,
                position.lineNumber,
                nextClose + 3,
              ),
              contents: [
                { value: `**${expr}**` },
                { value: `Node: \`${nodeId}\`${typeInfo}  \nOutput: \`${output}\`` },
              ],
            };
          }

          // $json
          if (expr === "$json") {
            return {
              range: new monaco.Range(
                position.lineNumber,
                lastOpen + 1,
                position.lineNumber,
                nextClose + 3,
              ),
              contents: [{ value: "**$json** — output of the predecessor node" }],
            };
          }

          // scope.name
          const scopeMatch = expr.match(/^(sys|session|tenant|env)\.(.+)$/);
          if (scopeMatch) {
            const scope = scopeMatch[1];
            const name = scopeMatch[2];
            return {
              range: new monaco.Range(
                position.lineNumber,
                lastOpen + 1,
                position.lineNumber,
                nextClose + 3,
              ),
              contents: [{ value: `**${expr}**  \nVariable \`${name}\` from scope \`${scope}\`` }],
            };
          }

          if (wordAtPos) {
            return null;
          }
          return null;
        },
      });
    },
    [],
  );

  const insertAtCursor = useCallback((text: string) => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const selection = editor.getSelection();
    if (!selection) {
      return;
    }
    editor.executeEdits("prompt-insert", [
      {
        range: selection,
        text,
        forceMoveMarkers: true,
      },
    ]);
    editor.focus();
  }, []);

  return (
    <div className="gc-prompt-editor-root" data-testid="gc-prompt-editor">
      <div className="gc-prompt-editor-bar">
        <span className="gc-prompt-editor-label">
          {placeholder ?? t("app.promptEditor.insertVariable")}
        </span>
        <VariablePicker
          availableNodes={availableNodes}
          availableVariables={availableVariables}
          onInsert={insertAtCursor}
        />
      </div>
      <div className="gc-prompt-editor-monaco" style={{ height }}>
        <Editor
          height={height}
          language={PROMPT_LANG_ID}
          value={value}
          theme="gc-prompt-light"
          beforeMount={beforeMount}
          onMount={onMount}
          options={{
            readOnly: ro,
            domReadOnly: ro,
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
            tabSize: 2,
            lineNumbers: "off",
            folding: false,
            glyphMargin: false,
            lineDecorationsWidth: 8,
            lineNumbersMinChars: 0,
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            overviewRulerBorder: false,
            quickSuggestions: { other: true, comments: false, strings: true },
            suggestOnTriggerCharacters: true,
            acceptSuggestionOnCommitCharacter: true,
          }}
          onChange={(v) => {
            if (!ro) {
              onChange(v ?? "");
            }
          }}
        />
      </div>
    </div>
  );
}
