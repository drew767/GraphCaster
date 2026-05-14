// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// ── Mock CodeMirror (same approach as InlineExpressionEditor tests) ───────────

let capturedUpdateListener: ((update: { docChanged: boolean; state: { doc: { toString: () => string } } }) => void) | null = null;
let mockDocContent = "";
const mockDispatch = vi.fn();

vi.mock("@codemirror/view", () => {
  class MockEditorView {
    state = { doc: { toString: () => mockDocContent }, selection: { main: { from: 0, to: 0 } } };
    dispatch = mockDispatch;
    focus = vi.fn();
    destroy = vi.fn();
    constructor({ state, parent }: { state: { doc: string }; parent: Element }) {
      if (parent) {
        const div = document.createElement("div");
        div.className = "cm-editor";
        div.setAttribute("data-codemirror", "true");
        parent.appendChild(div);
      }
      mockDocContent = state?.doc ?? "";
    }
  }
  return {
    EditorView: Object.assign(MockEditorView, {
      updateListener: { of: (fn: typeof capturedUpdateListener) => { capturedUpdateListener = fn; return {}; } },
      lineWrapping: {},
      theme: vi.fn(() => ({})),
      baseTheme: vi.fn(() => ({})),
    }),
    ViewPlugin: { fromClass: vi.fn(() => ({})) },
    Decoration: { mark: vi.fn(() => ({})) },
    keymap: { of: vi.fn(() => ({})) },
    tooltips: vi.fn(() => ({})),
    hoverTooltip: vi.fn(() => ({})),
  };
});

vi.mock("@codemirror/state", () => {
  class MockEditorState {
    doc = { toString: () => mockDocContent };
    static create({ doc }: { doc: string }) {
      const s = new MockEditorState();
      s.doc = { toString: () => doc };
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

import { ExpressionEditModal } from "../ExpressionEditModal";

const NODES = [
  { id: "FetchUser", type: "http", outputs: ["body", "status"] },
  { id: "Transform", type: "transform", outputs: ["result"] },
];

const VARS = [
  { scope: "sys" as const, name: "region" },
  { scope: "env" as const, name: "API_KEY" },
];

function renderModal(props: Partial<React.ComponentProps<typeof ExpressionEditModal>> = {}) {
  const onChange = props.onChange ?? vi.fn();
  const onClose = props.onClose ?? vi.fn();
  return {
    onChange,
    onClose,
    ...render(
      <ExpressionEditModal
        open={props.open ?? true}
        onClose={onClose}
        value={props.value ?? "{{ $now }}"}
        onChange={onChange}
        availableNodes={props.availableNodes ?? NODES}
        availableVariables={props.availableVariables ?? VARS}
        {...props}
      />,
    ),
  };
}

beforeEach(() => {
  capturedUpdateListener = null;
  mockDocContent = "";
  mockDispatch.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ExpressionEditModal (UX97)", () => {
  it("renders the modal when open=true", () => {
    renderModal({ open: true });
    expect(screen.getByText("Edit expression")).toBeTruthy();
  });

  it("does not render dialog content when open=false", () => {
    renderModal({ open: false });
    expect(screen.queryByText("Edit expression")).toBeNull();
  });

  it("sidebar tree renders Nodes, Variables, and Special sections", () => {
    renderModal();
    const sidebar = screen.getByRole("complementary", { name: /Data schema explorer/i });
    expect(sidebar.textContent).toContain("Nodes");
    expect(sidebar.textContent).toContain("Variables");
    expect(sidebar.textContent).toContain("Special");
  });

  it("clicking a sidebar leaf inserts text via editor dispatch", () => {
    renderModal();
    const sidebar = screen.getByRole("complementary", { name: /Data schema explorer/i });

    // Clear any dispatch calls from initial setup
    mockDispatch.mockClear();

    // The Special section is already expanded at depth=0.
    // Leaf buttons have title="Insert: $now" etc.
    const nowLeaf = sidebar.querySelector<HTMLButtonElement>('button[title="Insert: $now"]');
    expect(nowLeaf).toBeTruthy();
    fireEvent.click(nowLeaf!);

    // Should have dispatched an insert via the mock
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ changes: expect.objectContaining({ insert: "$now" }) }),
    );
  });

  it("Save button calls onChange with the current draft and closes modal", () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    renderModal({ value: "initial", onChange, onClose });

    // Simulate editing
    act(() => {
      if (capturedUpdateListener) {
        capturedUpdateListener({
          docChanged: true,
          state: { doc: { toString: () => "new expression" } },
        });
      }
    });

    const saveBtn = screen.getByText("Save");
    fireEvent.click(saveBtn);

    expect(onChange).toHaveBeenCalledWith("new expression");
    expect(onClose).toHaveBeenCalled();
  });

  it("displays evaluationError when provided", () => {
    renderModal({ evaluationError: "TypeError: cannot read property of undefined" });
    const err = screen.getByTestId("eval-error");
    expect(err.textContent).toContain("TypeError: cannot read property of undefined");
  });
});
