// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect } from "vitest";

import {
  createExpressionCompletion,
  STATIC_SUGGESTIONS,
} from "../completion";

/* ── Minimal CompletionContext stub ─────────────────────────────── */

interface MatchResult {
  from: number;
  to: number;
  text: string;
}

function makeContext({
  doc,
  pos,
  explicit = false,
}: {
  doc: string;
  pos: number;
  explicit?: boolean;
}) {
  return {
    pos,
    explicit,
    state: { doc: { toString: () => doc } },
    matchBefore(re: RegExp): MatchResult | null {
      const before = doc.slice(0, pos);
      const stickyRe = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags);
      // Walk backwards to find longest match ending at `pos`.
      for (let start = 0; start <= before.length; start++) {
        const slice = before.slice(start);
        const m = slice.match(new RegExp(`^(?:${stickyRe.source})$`));
        if (m && m[0].length === before.length - start) {
          return { from: start, to: pos, text: m[0] };
        }
      }
      return null;
    },
  };
}

describe("expressionCompletion", () => {
  it("returns expected suggestions just after `{{ `", () => {
    const source = createExpressionCompletion();
    const ctx = makeContext({ doc: "{{ ", pos: 3 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = source(ctx as any);
    expect(result).not.toBeNull();
    const labels = (result?.options ?? []).map((o) => o.label);
    for (const expected of [
      "$json",
      "$node",
      "$workflow",
      "$env",
      "$now",
      "$today",
      "$itemIndex",
      "$runIndex",
      "$execution.id",
      "$prevNode.name",
    ]) {
      expect(labels).toContain(expected);
    }
  });

  it("returns suggestions for `{{ $j` cursor position", () => {
    const source = createExpressionCompletion();
    const ctx = makeContext({ doc: "{{ $j", pos: 5 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = source(ctx as any);
    expect(result).not.toBeNull();
    const labels = (result?.options ?? []).map((o) => o.label);
    expect(labels).toContain("$json");
  });

  it("includes dynamic node names as $('NodeName')", () => {
    const source = createExpressionCompletion({
      getNodeNames: () => ["Fetch", "Transform"],
    });
    const ctx = makeContext({ doc: "{{ ", pos: 3 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = source(ctx as any);
    const labels = (result?.options ?? []).map((o) => o.label);
    expect(labels).toContain("$('Fetch')");
    expect(labels).toContain("$('Transform')");
  });

  it("returns null when not triggered and not explicit", () => {
    const source = createExpressionCompletion();
    const ctx = makeContext({ doc: "hello world", pos: 5 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = source(ctx as any);
    expect(result).toBeNull();
  });

  it("returns suggestions on explicit (Ctrl+Space) trigger", () => {
    const source = createExpressionCompletion();
    const ctx = makeContext({ doc: "plain text ", pos: 11, explicit: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = source(ctx as any);
    expect(result).not.toBeNull();
    expect(result?.options.length).toBeGreaterThanOrEqual(STATIC_SUGGESTIONS.length);
  });
});
