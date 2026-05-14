// Copyright GraphCaster. All Rights Reserved.

import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

const markBrace = Decoration.mark({ class: "gc-expr-brace" });
const markVar = Decoration.mark({ class: "gc-expr-var" });
const markStr = Decoration.mark({ class: "gc-expr-str" });
const markNum = Decoration.mark({ class: "gc-expr-num" });

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const text = doc.toString();
  const len = text.length;

  let i = 0;
  while (i < len) {
    const open = text.indexOf("{{", i);
    if (open < 0) break;
    const close = text.indexOf("}}", open + 2);
    const end = close < 0 ? len : close + 2;

    // Mark opening {{ braces
    builder.add(open, open + 2, markBrace);

    const innerStart = open + 2;
    const innerEnd = close < 0 ? len : close;

    // Scan inner content for tokens
    let j = innerStart;
    while (j < innerEnd) {
      const c = text[j];

      // String literals
      if (c === '"' || c === "'") {
        const quote = c;
        let k = j + 1;
        while (k < innerEnd) {
          if (text[k] === "\\" && k + 1 < innerEnd) {
            k += 2;
            continue;
          }
          if (text[k] === quote) {
            k++;
            break;
          }
          k++;
        }
        builder.add(j, k, markStr);
        j = k;
        continue;
      }

      // Number literals
      if (/[0-9]/.test(c) || (c === "-" && j + 1 < innerEnd && /[0-9]/.test(text[j + 1]))) {
        let k = j + (c === "-" ? 1 : 0);
        while (k < innerEnd && /[0-9.]/.test(text[k])) k++;
        if (k > j) {
          builder.add(j, k, markNum);
          j = k;
          continue;
        }
      }

      // Variable references starting with $
      if (c === "$") {
        let k = j + 1;
        while (k < innerEnd && /[a-zA-Z0-9_]/.test(text[k])) k++;
        if (k > j + 1) {
          builder.add(j, k, markVar);
          j = k;
          continue;
        }
      }

      j++;
    }

    // Mark closing }} braces
    if (close >= 0) {
      builder.add(close, close + 2, markBrace);
    }

    i = end;
  }

  return builder.finish();
}

export const expressionHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export const expressionHighlightTheme = EditorView.baseTheme({
  ".gc-expr-brace": { color: "#2563eb", fontWeight: "bold" },
  ".gc-expr-var": { color: "#7c3aed" },
  ".gc-expr-str": { color: "#d97706" },
  ".gc-expr-num": { color: "#16a34a" },
});
