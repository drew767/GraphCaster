// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "app.ndv.expression.resultLabel": "Result:",
        "app.ndv.fieldMode.switchToExpression": "Switch to expression mode",
        "app.ndv.fieldMode.switchToFixed": "Switch to fixed mode",
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock("../../../ui/Tooltip/Tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactElement }) => children,
}));

// InlineExpressionEditor depends on CodeMirror which is heavy in JSDOM.
// We replace it with a plain <textarea> that mirrors the relevant contract.
vi.mock("../../expression/InlineExpressionEditor", () => ({
  InlineExpressionEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      data-testid="inline-expression-editor-mock"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import { ParameterInput } from "../ParameterInput";
import { useNdvStore } from "../../useNdvStore";
import { MAPPING_MIME } from "../../input/DraggableKey";

beforeEach(() => {
  act(() => {
    useNdvStore.setState({
      activeNodeId: null,
      activeNodeType: null,
      panelWidths: {},
      inputView: {},
      outputView: {},
      itemIndex: {},
      fieldMode: {},
    });
  });
  localStorage.clear();
});

function fakeDataTransfer(payload?: { path: string; sourceNodeName: string }) {
  const store: Record<string, string> = {};
  if (payload) {
    store[MAPPING_MIME] = JSON.stringify(payload);
  }
  return {
    setData: vi.fn((type: string, data: string) => {
      store[type] = data;
    }),
    getData: vi.fn((type: string) => store[type] ?? ""),
    effectAllowed: "" as DataTransfer["effectAllowed"],
    dropEffect: "" as DataTransfer["dropEffect"],
    types: Object.keys(store),
  };
}

describe("ParameterInput drop handling", () => {
  it("accepts drop with mapping payload and inserts expression text", () => {
    const onChange = vi.fn();
    render(
      <ParameterInput paramKey="url" value="" onChange={onChange} />,
    );

    const wrap = screen.getByTestId("parameter-input-url");
    const target = wrap.querySelector(".gc-param-input") as HTMLElement;
    expect(target).not.toBeNull();

    const dt = fakeDataTransfer({
      path: "data.user.email",
      sourceNodeName: "Fetch User",
    });
    const dragOver = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(dragOver, "dataTransfer", { value: dt });
    target.dispatchEvent(dragOver);
    expect(dragOver.defaultPrevented).toBe(true);

    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: dt });
    target.dispatchEvent(drop);

    expect(onChange).toHaveBeenCalledWith(
      "{{ $('Fetch User').item.json.data.user.email }}",
    );
    expect(useNdvStore.getState().fieldMode["url"]).toBe("expression");
  });

  it("ignores drop without mapping payload", () => {
    const onChange = vi.fn();
    render(
      <ParameterInput paramKey="other" value="x" onChange={onChange} />,
    );
    const wrap = screen.getByTestId("parameter-input-other");
    const target = wrap.querySelector(".gc-param-input") as HTMLElement;

    const dt = fakeDataTransfer();
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: dt });
    target.dispatchEvent(drop);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders result strip when value contains an expression", () => {
    render(
      <ParameterInput
        paramKey="msg"
        value="{{ $json.name }}"
        onChange={vi.fn()}
        evaluationContext={{ inputItem: { name: "alice" } }}
      />,
    );
    const strip = screen.getByTestId("expression-result-strip");
    expect(strip.textContent).toContain("alice");
  });

  it("renders a plain input when in fixed mode and the expression editor when in expression mode", () => {
    const { rerender } = render(
      <ParameterInput paramKey="mode" value="hi" onChange={vi.fn()} />,
    );
    // Fixed mode by default → plain input
    expect(screen.queryByTestId("inline-expression-editor-mock")).toBeNull();

    act(() => {
      useNdvStore.getState().setFieldMode("mode", "expression");
    });
    rerender(<ParameterInput paramKey="mode" value="hi" onChange={vi.fn()} />);
    expect(screen.getByTestId("inline-expression-editor-mock")).toBeInTheDocument();
  });
});
