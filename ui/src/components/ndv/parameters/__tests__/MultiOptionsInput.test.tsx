// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { MultiOptionsInput } from "../MultiOptionsInput";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "app.ndv.parameters.types.multiOptions.add": "Add option",
        "app.ndv.parameters.types.multiOptions.selectOption": "Select option…",
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock("../../../ui/Select/Select", () => ({
  Select: ({
    value,
    onValueChange,
    options,
    "data-testid": testId,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    options: Array<{ value: string; label: string }>;
    "data-testid"?: string;
  }) => (
    <select
      value={value ?? ""}
      onChange={(e) => onValueChange?.(e.target.value)}
      data-testid={testId}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

describe("MultiOptionsInput", () => {
  it("renders selected options as chips", () => {
    render(
      <MultiOptionsInput
        value={["a"]}
        onChange={() => {}}
        options={options}
      />,
    );
    expect(screen.getByTestId("param-multi-options-chip-a")).toBeInTheDocument();
    expect(screen.queryByTestId("param-multi-options-chip-b")).not.toBeInTheDocument();
  });

  it("clicking a selected chip deselects it", () => {
    const onChange = vi.fn();
    render(
      <MultiOptionsInput
        value={["a"]}
        onChange={onChange}
        options={options}
      />,
    );
    fireEvent.click(screen.getByTestId("param-multi-options-chip-a"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("adds a new selection via the dropdown", () => {
    const onChange = vi.fn();
    render(
      <MultiOptionsInput
        value={[]}
        onChange={onChange}
        options={options}
      />,
    );
    fireEvent.change(screen.getByTestId("param-multi-options-add"), {
      target: { value: "a" },
    });
    expect(onChange).toHaveBeenCalledWith(["a"]);
  });
});
