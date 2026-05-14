// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import { NDV } from "../NDV";
import { useNdvStore } from "../useNdvStore";

/* ── mocks ──────────────────────────────────────────────────────── */

vi.mock("../useNdvLayout", () => ({
  useNdvLayout: () => ({
    inputWidth: 320,
    outputWidth: 320,
    setInputWidth: vi.fn(),
    setOutputWidth: vi.fn(),
  }),
}));

vi.mock("../../ui/AlertDialog/AlertDialog", () => ({
  AlertDialog: ({
    open,
    onConfirm,
    onCancel,
    title,
    confirmLabel,
    cancelLabel,
  }: {
    open?: boolean;
    onConfirm: () => void;
    onCancel?: () => void;
    title: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }) =>
    open ? (
      <div role="alertdialog" aria-label={title}>
        <button onClick={onConfirm}>{confirmLabel ?? "Confirm"}</button>
        <button onClick={onCancel}>{cancelLabel ?? "Cancel"}</button>
      </div>
    ) : null,
}));

vi.mock("../../ui/Icon/Icon", () => ({
  Icon: ({ name, "aria-label": ariaLabel }: { name: string; "aria-label"?: string }) => (
    <span data-testid={`icon-${name}`} aria-label={ariaLabel} />
  ),
}));

vi.mock("../../ui/InlineTextEdit/InlineTextEdit", () => ({
  InlineTextEdit: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
  }) => (
    <input
      data-testid="inline-text-edit"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock("../../ui/Switch/Switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
  }: {
    checked: boolean;
    onCheckedChange: (v: boolean) => void;
  }) => (
    <button
      data-testid="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
    />
  ),
}));

vi.mock("../../ui/Button/Button", () => ({
  Button: ({
    onClick,
    "aria-label": ariaLabel,
    children,
  }: {
    onClick?: () => void;
    "aria-label"?: string;
    children?: React.ReactNode;
  }) => (
    <button onClick={onClick} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}));

vi.mock("../../ui/Link/Link", () => ({
  Link: ({
    href,
    children,
  }: {
    href: string;
    children?: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

/* ── ensure portal target exists ─────────────────────────────── */
beforeEach(() => {
  let el = document.getElementById("gc-app-modals");
  if (!el) {
    el = document.createElement("div");
    el.id = "gc-app-modals";
    document.body.appendChild(el);
  }
  localStorage.clear();
  act(() => {
    useNdvStore.setState({
      activeNodeId: null,
      activeNodeType: null,
      panelWidths: {},
    });
  });
});

/* ── helpers ───────────────────────────────────────────────────── */
function makeProps(overrides: Partial<React.ComponentProps<typeof NDV>> = {}): React.ComponentProps<typeof NDV> {
  return {
    open: true,
    onClose: vi.fn(),
    nodeId: "node-1",
    nodeType: "task",
    nodeName: "My Task",
    onNodeNameChange: vi.fn(),
    parametersPanel: <div data-testid="params-content">Params</div>,
    ...overrides,
  };
}

/* ── tests ─────────────────────────────────────────────────────── */
describe("NDV", () => {
  it("renders when open=true", () => {
    render(<NDV {...makeProps()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not render when open=false", () => {
    render(<NDV {...makeProps({ open: false })} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<NDV {...makeProps({ onClose })} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when backdrop is clicked", () => {
    const onClose = vi.fn();
    render(<NDV {...makeProps({ onClose })} />);
    const backdrop = document.querySelector(".gc-ndv-backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(<NDV {...makeProps({ onClose })} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders parametersPanel slot content", () => {
    render(
      <NDV
        {...makeProps({
          parametersPanel: <div data-testid="params-panel">My Params</div>,
        })}
      />,
    );
    expect(screen.getByTestId("params-panel")).toBeInTheDocument();
  });

  it("renders inputPanel and outputPanel slots when provided", () => {
    render(
      <NDV
        {...makeProps({
          inputPanel: <div data-testid="input-panel">Input</div>,
          outputPanel: <div data-testid="output-panel">Output</div>,
        })}
      />,
    );
    expect(screen.getByTestId("input-panel")).toBeInTheDocument();
    expect(screen.getByTestId("output-panel")).toBeInTheDocument();
  });

  it("renders empty placeholders when side panels are not provided", () => {
    render(<NDV {...makeProps()} />);
    expect(screen.getByText("Input data")).toBeInTheDocument();
    expect(screen.getByText("Output data")).toBeInTheDocument();
  });

  it("renders InlineTextEdit with nodeName value", () => {
    render(<NDV {...makeProps({ nodeName: "Fancy Node" })} />);
    const input = screen.getByTestId("inline-text-edit");
    expect(input).toHaveValue("Fancy Node");
  });

  it("calls onNodeNameChange when InlineTextEdit changes", () => {
    const onNodeNameChange = vi.fn();
    render(<NDV {...makeProps({ onNodeNameChange })} />);
    const input = screen.getByTestId("inline-text-edit");
    fireEvent.change(input, { target: { value: "New Name" } });
    expect(onNodeNameChange).toHaveBeenCalledWith("New Name");
  });

  it("calls onToggleDisabled when switch is toggled", () => {
    const onToggleDisabled = vi.fn();
    render(
      <NDV
        {...makeProps({ isDisabled: false, onToggleDisabled })}
      />,
    );
    fireEvent.click(screen.getByTestId("switch"));
    expect(onToggleDisabled).toHaveBeenCalledWith(true);
  });

  it("renders docs link when docsUrl is provided", () => {
    render(
      <NDV {...makeProps({ docsUrl: "https://docs.example.com/task" })} />,
    );
    const link = screen.getByRole("link", { name: /docs/i });
    expect(link).toHaveAttribute("href", "https://docs.example.com/task");
  });

  it("does not render docs link when docsUrl is not provided", () => {
    render(<NDV {...makeProps()} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows discard dialog when close is clicked with dirty=true and errors", () => {
    const onClose = vi.fn();
    render(
      <NDV
        {...makeProps({ onClose })}
        dirtyControls={{
          dirty: true,
          errors: { "params.url": "required" },
          markDirty: vi.fn(),
          markClean: vi.fn(),
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose after confirming discard in the dialog", () => {
    const onClose = vi.fn();
    const markClean = vi.fn();
    render(
      <NDV
        {...makeProps({ onClose })}
        dirtyControls={{
          dirty: true,
          errors: { "params.url": "required" },
          markDirty: vi.fn(),
          markClean,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    expect(markClean).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
