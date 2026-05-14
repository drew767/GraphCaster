// Copyright GraphCaster. All Rights Reserved.

import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
  type Completion,
} from "@codemirror/autocomplete";

export interface AvailableNode {
  id: string;
  type: string;
  outputs: string[];
}

export interface AvailableVariable {
  scope: "sys" | "session" | "tenant" | "env" | "run";
  name: string;
}

export interface AutocompleteSources {
  availableNodes: AvailableNode[];
  availableVariables: AvailableVariable[];
}

const SPECIAL_TOKENS: Array<{ label: string; insert: string; info: string }> = [
  { label: "$now", insert: "$now", info: "Current datetime as ISO string" },
  { label: "$today", insert: "$today", info: "Current date as ISO date string" },
  { label: "$workflow.id", insert: "$workflow.id", info: "Current workflow ID" },
  { label: "$execution.id", insert: "$execution.id", info: "Current execution ID" },
  { label: "$input.first()", insert: "$input.first()", info: "First item from input" },
  { label: "$input.last()", insert: "$input.last()", info: "Last item from input" },
  { label: "$input.all()", insert: "$input.all()", info: "All items from input as array" },
  { label: "$json", insert: "$json", info: "JSON data of current item" },
  { label: "$node", insert: "$node", info: "Reference an upstream node by name" },
];

function cursorInsideMustache(text: string, cursor: number): boolean {
  const before = text.slice(0, cursor);
  const open = before.lastIndexOf("{{");
  if (open < 0) return false;
  const close = before.lastIndexOf("}}");
  return open > close;
}

function buildCompletions(sources: AutocompleteSources) {
  return function expressionCompletions(ctx: CompletionContext): CompletionResult | null {
    const { state, pos } = ctx;
    const text = state.doc.toString();

    const inside = cursorInsideMustache(text, pos);

    // Trigger on `{{` entry: match just after `{{` with optional whitespace
    const openBrace = ctx.matchBefore(/\{\{\s*/);
    if (openBrace) {
      const completions: Completion[] = [
        ...SPECIAL_TOKENS.map((t) => ({
          label: t.label,
          apply: t.insert,
          info: t.info,
          type: "variable" as const,
        })),
        ...sources.availableNodes.flatMap((node) => {
          const nodeItems: Completion[] = [
            {
              label: `$node.${node.id}`,
              apply: `$node["${node.id}"]`,
              info: `Reference node: ${node.id} (${node.type})`,
              type: "variable" as const,
            },
            ...node.outputs.map((out) => ({
              label: `$node.${node.id}.${out}`,
              apply: `$node["${node.id}"]["${out}"]`,
              info: `Output "${out}" from node "${node.id}"`,
              type: "property" as const,
            })),
          ];
          return nodeItems;
        }),
        ...sources.availableVariables.map((v) => ({
          label: `${v.scope}.${v.name}`,
          apply: `${v.scope}.${v.name}`,
          info: `Variable in ${v.scope} scope`,
          type: "variable" as const,
        })),
      ];
      return { from: pos, options: completions, validFor: /^.*$/ };
    }

    if (!inside) return null;

    // Autocomplete after a dot: $json.fieldName, $node.X.Y, scope.name
    const dotMatch = ctx.matchBefore(/\$json\.\w*/);
    if (dotMatch) {
      const prefix = dotMatch.text.slice("$json.".length);
      const options: Completion[] = sources.availableNodes
        .flatMap((n) => n.outputs)
        .filter((o, i, arr) => arr.indexOf(o) === i)
        .filter((o) => o.toLowerCase().startsWith(prefix.toLowerCase()))
        .map((o) => ({
          label: `$json.${o}`,
          apply: `$json.${o}`,
          info: `JSON field: ${o}`,
          type: "property" as const,
        }));
      return { from: dotMatch.from, options, validFor: /^\$json\.\w*$/ };
    }

    // Autocomplete $node["nodeName"] style
    const nodeMatch = ctx.matchBefore(/\$node\[\s*["'][^"']*$/);
    if (nodeMatch) {
      const quoteChar = nodeMatch.text.includes('"') ? '"' : "'";
      const partialIdx = nodeMatch.text.lastIndexOf(quoteChar) + 1;
      const partial = nodeMatch.text.slice(partialIdx);
      const options: Completion[] = sources.availableNodes
        .filter((n) => n.id.toLowerCase().includes(partial.toLowerCase()))
        .map((n) => ({
          label: n.id,
          apply: `$node["${n.id}"]`,
          info: `Node: ${n.id} (${n.type})`,
          type: "variable" as const,
        }));
      return { from: nodeMatch.from, options };
    }

    // Autocomplete $variable references
    const dollarMatch = ctx.matchBefore(/\$[a-zA-Z_][\w.]*/);
    if (dollarMatch) {
      const prefix = dollarMatch.text.slice(1).toLowerCase();
      const options: Completion[] = SPECIAL_TOKENS.filter((t) =>
        t.label.slice(1).toLowerCase().startsWith(prefix),
      ).map((t) => ({
        label: t.label,
        apply: t.insert,
        info: t.info,
        type: "variable" as const,
      }));
      return { from: dollarMatch.from, options, validFor: /^\$[\w.]*$/ };
    }

    // Scope variables: sys.*, session.*, etc.
    const scopeMatch = ctx.matchBefore(/(sys|session|tenant|env|run)\.\w*/);
    if (scopeMatch) {
      const [scopePart] = scopeMatch.text.split(".");
      const scope = scopePart as AvailableVariable["scope"];
      const prefix = scopeMatch.text.slice(scopePart.length + 1).toLowerCase();
      const options: Completion[] = sources.availableVariables
        .filter((v) => v.scope === scope && v.name.toLowerCase().startsWith(prefix))
        .map((v) => ({
          label: `${v.scope}.${v.name}`,
          apply: `${v.scope}.${v.name}`,
          info: `Variable in ${v.scope} scope`,
          type: "variable" as const,
        }));
      return { from: scopeMatch.from, options };
    }

    return null;
  };
}

export function buildExpressionAutocomplete(sources: AutocompleteSources) {
  return autocompletion({
    override: [buildCompletions(sources)],
    closeOnBlur: false,
  });
}
