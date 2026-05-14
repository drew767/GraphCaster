// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PromptEditor } from "../PromptEditor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Monaco editor mock — renders a simple textarea that calls onChange/onMount
vi.mock("@monaco-editor/react", () => {
  type MockEditorProps = {
    value?: string;
    onChange?: (val: string) => void;
    onMount?: (editor: unknown, monaco: unknown) => void;
    beforeMount?: (monaco: unknown) => void;
    height?: number | string;
  };
  const Editor = ({
    value = "",
    onChange,
    onMount,
    beforeMount,
    height,
  }: MockEditorProps) => {
    // Call beforeMount/onMount with stubs so the component wires up correctly
    if (beforeMount) {
      beforeMount({
        languages: {
          register: vi.fn(),
          setMonarchTokensProvider: vi.fn(),
          registerCompletionItemProvider: vi.fn(),
          registerHoverProvider: vi.fn(),
          CompletionItemKind: { Variable: 4, Field: 3 },
        },
        editor: {
          defineTheme: vi.fn(),
        },
        Range: class {
          constructor(
            public readonly startLineNumber: number,
            public readonly startColumn: number,
            public readonly endLineNumber: number,
            public readonly endColumn: number,
          ) {}
        },
      });
    }
    const fakeEditor = {
      getSelection: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }),
      executeEdits: vi.fn(),
      focus: vi.fn(),
    };
    if (onMount) {
      onMount(fakeEditor, {
        languages: {
          registerCompletionItemProvider: vi.fn(),
          registerHoverProvider: vi.fn(),
          CompletionItemKind: { Variable: 4, Field: 3 },
        },
        Range: class {
          constructor(
            public readonly startLineNumber: number,
            public readonly startColumn: number,
            public readonly endLineNumber: number,
            public readonly endColumn: number,
          ) {}
        },
      });
    }
    return (
      <div data-testid="monaco-editor" style={{ height: String(height) }}>
        <textarea
          data-testid="monaco-textarea"
          value={value}
          readOnly={false}
          onChange={(e) => onChange?.(e.target.value)}
        />
      </div>
    );
  };
  return { default: Editor };
});

const sampleNodes = [
  { id: "task1", type: "task", outputs: ["out_default"] },
  { id: "agent1", type: "agent", outputs: ["out_default", "out_error"] },
];

const sampleVariables = [
  { scope: "sys" as const, name: "run_id" },
  { scope: "session" as const, name: "user_id" },
];

describe("PromptEditor rendering", () => {
  it("renders the editor root", () => {
    render(
      <PromptEditor
        value="hello"
        onChange={vi.fn()}
        availableNodes={sampleNodes}
        availableVariables={sampleVariables}
      />,
    );
    expect(screen.getByTestId("gc-prompt-editor")).toBeInTheDocument();
  });

  it("renders the Monaco editor area", () => {
    render(
      <PromptEditor
        value="hello {{ $node.task1.out_default }}"
        onChange={vi.fn()}
        availableNodes={sampleNodes}
      />,
    );
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
  });

  it("calls onChange when user types in textarea", () => {
    const handleChange = vi.fn();
    render(
      <PromptEditor value="" onChange={handleChange} availableNodes={sampleNodes} />,
    );
    const textarea = screen.getByTestId("monaco-textarea");
    fireEvent.change(textarea, { target: { value: "new content" } });
    expect(handleChange).toHaveBeenCalledWith("new content");
  });

  it("renders variable picker toggle button", () => {
    render(
      <PromptEditor value="" onChange={vi.fn()} availableNodes={sampleNodes} />,
    );
    const toggleBtn = screen.getByRole("button", {
      name: "app.promptEditor.insertVariable",
    });
    expect(toggleBtn).toBeInTheDocument();
  });

  it("variable picker opens on toggle click showing node section", () => {
    render(
      <PromptEditor
        value=""
        onChange={vi.fn()}
        availableNodes={sampleNodes}
        availableVariables={sampleVariables}
      />,
    );
    const toggleBtn = screen.getByRole("button", {
      name: "app.promptEditor.insertVariable",
    });
    fireEvent.click(toggleBtn);
    expect(screen.getByText("app.promptEditor.fromNode")).toBeInTheDocument();
    expect(screen.getByText("app.promptEditor.fromVariableScope")).toBeInTheDocument();
  });

  it("variable picker lists node output items", () => {
    render(
      <PromptEditor
        value=""
        onChange={vi.fn()}
        availableNodes={sampleNodes}
        availableVariables={[]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "app.promptEditor.insertVariable" }),
    );
    expect(screen.getByText("$node.task1.out_default")).toBeInTheDocument();
    expect(screen.getByText("$node.agent1.out_default")).toBeInTheDocument();
    expect(screen.getByText("$node.agent1.out_error")).toBeInTheDocument();
  });

  it("clicking an item in variable picker inserts at cursor", () => {
    const handleChange = vi.fn();
    render(
      <PromptEditor
        value=""
        onChange={handleChange}
        availableNodes={sampleNodes}
        availableVariables={[]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "app.promptEditor.insertVariable" }),
    );
    fireEvent.click(screen.getByText("$node.task1.out_default"));
    // The VariablePicker calls onInsert with "{{ $node.task1.out_default }}"
    // which in turn calls insertAtCursor on the (mocked) editor
    // The popover should close after the click
    expect(screen.queryByText("app.promptEditor.fromNode")).toBeNull();
  });

  it("shows empty state message when no upstream nodes", () => {
    render(
      <PromptEditor value="" onChange={vi.fn()} availableNodes={[]} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "app.promptEditor.insertVariable" }),
    );
    expect(screen.getByText("app.promptEditor.noUpstreamNodes")).toBeInTheDocument();
  });
});
