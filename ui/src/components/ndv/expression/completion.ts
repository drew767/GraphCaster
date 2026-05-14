// Copyright GraphCaster. All Rights Reserved.

import type {
  CompletionContext,
  CompletionResult,
  CompletionSource,
  Completion,
} from "@codemirror/autocomplete";

/**
 * Static expression suggestions surfaced after `{{` or via Ctrl+Space.
 */
export const STATIC_SUGGESTIONS: Array<{ label: string; insert?: string; info?: string }> = [
  { label: "$json", info: "JSON data of the current item" },
  { label: "$node", info: "Reference an upstream node by name" },
  { label: "$workflow", info: "Workflow metadata object" },
  { label: "$env", info: "Environment variables" },
  { label: "$now", info: "Current datetime as ISO string" },
  { label: "$today", info: "Current date as ISO date string" },
  { label: "$itemIndex", info: "Index of the current item" },
  { label: "$runIndex", info: "Index of the current run" },
  { label: "$execution.id", info: "Current execution id" },
  { label: "$prevNode.name", info: "Name of the previous node" },
];

export interface ExpressionCompletionOptions {
  /**
   * Returns the display names of all nodes in the current workflow.
   * Defaults to a no-op returning [].
   */
  getNodeNames?: () => string[];
}

function buildOptions(getNodeNames: () => string[]): Completion[] {
  const dynamic: Completion[] = getNodeNames().map((name) => ({
    label: `$('${name}')`,
    apply: `$('${name}')`,
    info: `Reference node "${name}"`,
    type: "variable",
  }));

  const staticOpts: Completion[] = STATIC_SUGGESTIONS.map((s) => ({
    label: s.label,
    apply: s.insert ?? s.label,
    info: s.info,
    type: "variable",
  }));

  return [...staticOpts, ...dynamic];
}

/**
 * Build an expression-aware {@link CompletionSource}.
 *
 * Triggers:
 * - Right after `{{` (with optional whitespace) — list everything.
 * - On an explicit Ctrl+Space (`context.explicit === true`) — list everything.
 * - After typing `$` (partial token) — filter the static / dynamic set.
 */
export function createExpressionCompletion(
  opts: ExpressionCompletionOptions = {},
): CompletionSource {
  const getNodeNames = opts.getNodeNames ?? (() => []);

  return (context: CompletionContext): CompletionResult | null => {
    const open = context.matchBefore(/\{\{\s*/);
    if (open && open.to === context.pos) {
      return {
        from: context.pos,
        options: buildOptions(getNodeNames),
        validFor: /^[\w$.()'"`-]*$/,
      };
    }

    const dollar = context.matchBefore(/\$[\w.$]*/);
    if (dollar && dollar.from !== dollar.to) {
      return {
        from: dollar.from,
        options: buildOptions(getNodeNames),
        validFor: /^\$[\w.$]*$/,
      };
    }

    if (context.explicit) {
      return {
        from: context.pos,
        options: buildOptions(getNodeNames),
        validFor: /^[\w$.()'"`-]*$/,
      };
    }

    return null;
  };
}

/** Default export — empty dynamic suggestions. */
export const expressionCompletion: CompletionSource = createExpressionCompletion();
