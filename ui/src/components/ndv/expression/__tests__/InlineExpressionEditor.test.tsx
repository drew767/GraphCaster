// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

// ── Mock CodeMirror ───────────────────────────────────────────────────────────
// CodeMirror relies on browser layout APIs unavailable in JSDOM.
// We mock the view layer; state logic is tested via the component interface.

const mockDispatch = vi.fn();
let capturedUpdateListener: ((update: { docChanged: boolean; state: { doc: { toString: () => string } } }) => void) | null = null;
let mockDocContent = "";

vi.mock("@codemirror/view", () => {
  class MockEditorView {
    state = { doc: { toString: () => mockDocContent }, selection: { main: { from: 0, to: 0 } } };
    dispatch = mockDispatch;
    focus = vi.fn();
    destroy = vi.fn();
    constructor({ state, parent }: { state: { extensions: unknown[]; doc: string }; parent: Element }) {
      if (parent) {
        const div = document.createElement("div");
        div.className = "cm-editor";
        div.setAttribute("data-codemirror", "true");
        parent.appendChild(div);
      }
      mockDocContent = state?.doc ?? "";
    }
  }
  const mockViewPlugin = { fromClass: vi.fn(() => ({})) };
  return {
    EditorView: Object.assign(MockEditorView, {
      updateListener: { of: (fn: typeof capturedUpdateListener) => { capturedUpdateListener = fn; return {}; } },
      lineWrapping: {},
      theme: vi.fn(() => ({})),
      baseTheme: vi.fn(() => ({})),
    }),
    ViewPlugin: mockViewPlugin,
    Decoration: { mark: vi.fn(() => ({})) },
    keymap: { of: vi.fn(() => ({})) },
    tooltips: vi.fn(() => ({})),
    hoverTooltip: vi.fn(() => ({})),
  };
});

vi.mock("@codemirror/state", () => {
  class MockEditorState {
    doc = { toString: () => mockDocContent };
    extensions: unknown[] = [];
    static create({ doc, extensions }: { doc: string; extensions: unknown[] }) {
      const s = new MockEditorState();
      s.doc = { toString: () => doc };
      s.extensions = extensions;
      mockDocContent = doc;
      return s;
    }
    static readOnly = { of: vi.fn(() => ({})) };
    static transactionFilter = { of: vi.fn(() => ({})) };
    static allowMultipleSelections = { of: vi.fn(() => ({})) };
  }
  return {
    EditorState: MockEditorState,
    RangeSetBuilder: class { add = vi.fn(); finish = vi.fn(() => ({})); },
    Transaction: {},
  };
});

vi.mock("@codemirror/autocomplete", () => ({
  autocompletion: vi.fn(() => ({})),
  CompletionContext: class {},
}));

vi.mock("@codemirror/commands", () => ({
  defaultKeymap: [],
  historyKeymap: [],
  history: vi.fn(() => ({})),
}));

vi.mock("@codemirror/language", () => ({
  HighlightStyle: { define: vi.fn(() => ({})) },
  syntaxHighlighting: vi.fn(() => ({})),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { InlineExpressionEditor } from "../InlineExpressionEditor";

const SAMPLE_NODES = [
  { id: "FetchUser", type: "http", outputs: ["body", "status"] },
  { id: "ParseData", type: "transform", outputs: ["result"] },
];

const SAMPLE_VARS = [
  { scope: "sys" as const, name: "region" },
  { scope: "session" as const, name: "userId" },
];

function renderEditor(props: Partial<React.ComponentProps<typeof InlineExpressionEditor>> = {}) {
  const onChange = props.onChange ?? vi.fn();
  return render(
    <InlineExpressionEditor
      value={props.value ?? ""}
      onChange={onChange}
      availableNodes={props.availableNodes ?? SAMPLE_NODES}
      availableVariables={props.availableVariables ?? SAMPLE_VARS}
      {...props}
    />,
  );
}

beforeEach(() => {
  mockDispatch.mockClear();
  capturedUpdateListener = null;
  mockDocContent = "";
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("InlineExpressionEditor (UX97)", () => {
  it("renders the editor container", () => {
    renderEditor({ value: "hello" });
    expect(screen.getByTestId("inline-expression-editor")).toBeTruthy();
  });

  it("mounts a CodeMirror div inside the container", () => {
    renderEditor({ value: "" });
    const container = screen.getByTestId("inline-expression-editor");
    expect(container.querySelector("[data-codemirror]")).toBeTruthy();
  });

  it("emits onChange when the editor content changes", () => {
    const onChange = vi.fn();
    renderEditor({ value: "initial", onChange });
    // Simulate editor update
    act(() => {
      if (capturedUpdateListener) {
        capturedUpdateListener({
          docChanged: true,
          state: { doc: { toString: () => "updated value" } },
        });
      }
    });
    expect(onChange).toHaveBeenCalledWith("updated value");
  });

  it("does not emit onChange when doc did not change", () => {
    const onChange = vi.fn();
    renderEditor({ value: "initial", onChange });
    act(() => {
      if (capturedUpdateListener) {
        capturedUpdateListener({
          docChanged: false,
          state: { doc: { toString: () => "initial" } },
        });
      }
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("dispatches a content update when the value prop changes externally", () => {
    const { rerender } = renderEditor({ value: "first" });
    mockDocContent = "first";
    rerender(
      <InlineExpressionEditor
        value="second"
        onChange={vi.fn()}
        availableNodes={SAMPLE_NODES}
      />,
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ changes: expect.objectContaining({ insert: "second" }) }),
    );
  });

  it("does not dispatch when value prop matches current doc", () => {
    mockDocContent = "same";
    const { rerender } = renderEditor({ value: "same" });
    mockDispatch.mockClear();
    rerender(
      <InlineExpressionEditor
        value="same"
        onChange={vi.fn()}
        availableNodes={SAMPLE_NODES}
      />,
    );
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("renders resolved preview when resolvedPreview prop is passed", () => {
    renderEditor({ value: "{{ $now }}", resolvedPreview: "2026-05-12T10:00:00Z" });
    const preview = screen.getByTestId("expression-preview");
    expect(preview.textContent).toContain("2026-05-12T10:00:00Z");
    expect(preview.textContent).toContain("Preview:");
  });

  it("does not render preview section when resolvedPreview is undefined", () => {
    renderEditor({ value: "plain text" });
    expect(screen.queryByTestId("expression-preview")).toBeNull();
  });

  it("accepts multiline prop without error", () => {
    expect(() => renderEditor({ value: "line1", multiline: true })).not.toThrow();
  });

  it("single-line mode is the default and does not throw", () => {
    expect(() => renderEditor({ value: "one line", multiline: false })).not.toThrow();
  });
});
