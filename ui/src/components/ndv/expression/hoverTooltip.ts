// Copyright GraphCaster. All Rights Reserved.

import { hoverTooltip, type Tooltip } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

import {
  evaluateExpression,
  formatEvaluated,
  type EvaluationContext,
} from "./evaluator";

export interface ResolveHoverOptions {
  /** Provides the current evaluation context (input item, etc.). */
  getContext: () => EvaluationContext;
}

const EXPR_RE = /\{\{[^}]*\}\}/g;

/** Locate the `{{...}}` block under cursor position `pos` in `text`. */
export function findExpressionAt(
  text: string,
  pos: number,
): { from: number; to: number; expression: string } | null {
  EXPR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXPR_RE.exec(text)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    if (pos >= from && pos <= to) {
      return { from, to, expression: match[0] };
    }
  }
  return null;
}

/**
 * Build a hover tooltip that resolves `{{ ... }}` expressions when the
 * cursor lingers over them.
 */
export function buildResolveHoverTooltip(
  opts: ResolveHoverOptions,
): Extension {
  return hoverTooltip((view, pos) => {
    const text = view.state.doc.toString();
    const hit = findExpressionAt(text, pos);
    if (!hit) return null;

    return {
      pos: hit.from,
      end: hit.to,
      above: true,
      create(): { dom: HTMLElement } {
        const result = evaluateExpression(hit.expression, opts.getContext());
        const dom = document.createElement("div");
        dom.className = "gc-expr-tooltip gc-expr-tooltip--resolved";
        if (result.ok) {
          dom.textContent = formatEvaluated(result.value, 80);
        } else {
          dom.classList.add("gc-expr-tooltip--error");
          dom.textContent = `⚠ ${result.error}`;
        }
        return { dom };
      },
    } satisfies Tooltip;
  });
}
