// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi } from "vitest";

vi.mock("@codemirror/view", () => ({
  hoverTooltip: (fn: unknown) => ({ __tooltip: true, source: fn }),
}));

import { buildResolveHoverTooltip, findExpressionAt } from "../hoverTooltip";

interface FakeView {
  state: { doc: { toString: () => string } };
}

function makeView(text: string): FakeView {
  return { state: { doc: { toString: () => text } } };
}

describe("findExpressionAt", () => {
  it("finds the expression block containing the cursor", () => {
    const text = "hello {{ $json.user }} world";
    const hit = findExpressionAt(text, 12);
    expect(hit).not.toBeNull();
    expect(hit?.expression).toBe("{{ $json.user }}");
    expect(hit?.from).toBe(6);
    expect(hit?.to).toBe(22);
  });

  it("returns null when cursor is not inside any expression", () => {
    const text = "hello {{ $json.user }} world";
    const hit = findExpressionAt(text, 1);
    expect(hit).toBeNull();
  });

  it("supports multiple expressions in one string", () => {
    const text = "{{ $json.a }}-{{ $json.b }}";
    const first = findExpressionAt(text, 5);
    expect(first?.expression).toBe("{{ $json.a }}");
    const second = findExpressionAt(text, 18);
    expect(second?.expression).toBe("{{ $json.b }}");
  });
});

describe("buildResolveHoverTooltip", () => {
  it("returns a tooltip with the resolved value when cursor is over an expression", () => {
    const ext = buildResolveHoverTooltip({
      getContext: () => ({ inputItem: { user: { email: "alice@example.com" } } }),
    }) as unknown as {
      source: (view: FakeView, pos: number) => null | {
        pos: number;
        end: number;
        create: () => { dom: HTMLElement };
      };
    };

    const view = makeView("{{ $json.user.email }}");
    const tip = ext.source(view, 5);
    expect(tip).not.toBeNull();
    if (!tip) return;
    const { dom } = tip.create();
    expect(dom.textContent).toContain("alice@example.com");
    expect(dom.className).toContain("gc-expr-tooltip");
  });

  it("returns null when cursor is outside any expression", () => {
    const ext = buildResolveHoverTooltip({
      getContext: () => ({ inputItem: {} }),
    }) as unknown as {
      source: (view: FakeView, pos: number) => unknown;
    };
    const view = makeView("plain text without expressions");
    expect(ext.source(view, 2)).toBeNull();
  });

  it("renders an error tooltip when the path cannot resolve", () => {
    const ext = buildResolveHoverTooltip({
      getContext: () => ({ inputItem: {} }),
    }) as unknown as {
      source: (view: FakeView, pos: number) => null | {
        create: () => { dom: HTMLElement };
      };
    };
    const view = makeView("{{ $json.missing }}");
    const tip = ext.source(view, 4);
    expect(tip).not.toBeNull();
    if (!tip) return;
    const { dom } = tip.create();
    expect(dom.className).toContain("gc-expr-tooltip--error");
    expect(dom.textContent).toContain("⚠");
  });
});
