// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ParameterCollection } from "../ParameterCollection";
import type { CollectionChildField } from "../ParameterCollection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "app.ndv.parameters.types.collection.addField": "Add field",
        "app.ndv.parameters.types.collection.removeRow": "Remove row",
        "app.ndv.parameters.types.collection.addRow": "Add row",
        "app.ndv.parameters.types.collection.selectField": "Select field…",
        "app.ndv.parameters.types.collection.row": "Row",
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock("../../../ui/Button/Button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    "data-testid": testId,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    "data-testid"?: string;
    iconLeft?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} data-testid={testId}>
      {children}
    </button>
  ),
}));

vi.mock("../../../ui/Input/Input", () => ({
  Input: ({
    value,
    onChange,
    disabled,
    "data-testid": testId,
    "aria-label": ariaLabel,
  }: {
    value?: string;
    onChange?: React.ChangeEventHandler<HTMLInputElement>;
    disabled?: boolean;
    "data-testid"?: string;
    "aria-label"?: string;
  }) => (
    <input
      value={value ?? ""}
      onChange={onChange}
      disabled={disabled}
      data-testid={testId}
      aria-label={ariaLabel}
    />
  ),
}));

vi.mock("../../../ui/InputNumber/InputNumber", () => ({
  InputNumber: ({
    value,
    onChange,
    "data-testid": testId,
  }: {
    value?: number;
    onChange?: (v: number | null) => void;
    "data-testid"?: string;
  }) => (
    <input
      type="number"
      value={value ?? ""}
      onChange={(e) =>
        onChange?.(e.target.value === "" ? null : Number(e.target.value))
      }
      data-testid={testId}
    />
  ),
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

vi.mock("../../../ui/Switch/Switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    "data-testid": testId,
  }: {
    checked?: boolean;
    onCheckedChange?: (b: boolean) => void;
    "data-testid"?: string;
  }) => (
    <input
      type="checkbox"
      checked={checked ?? false}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      data-testid={testId}
    />
  ),
}));

const children: CollectionChildField[] = [
  { name: "key", label: "Key", type: "string", defaultValue: "" },
  { name: "count", label: "Count", type: "number", defaultValue: 0 },
];

describe("ParameterCollection", () => {
  it("adds a row when Add row is clicked", () => {
    const onChange = vi.fn();
    render(
      <ParameterCollection value={[]} onChange={onChange} children={children} />,
    );
    fireEvent.click(screen.getByTestId("param-collection-add-row"));
    expect(onChange).toHaveBeenCalledWith([{ key: "", count: 0 }]);
  });

  it("renders existing rows", () => {
    render(
      <ParameterCollection
        value={[{ key: "a", count: 1 }]}
        onChange={() => {}}
        children={children}
      />,
    );
    expect(screen.getByTestId("param-collection-row-0")).toBeInTheDocument();
  });

  it("removes a row when Remove is clicked", () => {
    const onChange = vi.fn();
    render(
      <ParameterCollection
        value={[{ key: "a" }, { key: "b" }]}
        onChange={onChange}
        children={children}
      />,
    );
    fireEvent.click(screen.getByTestId("param-collection-remove-0"));
    expect(onChange).toHaveBeenCalledWith([{ key: "b" }]);
  });
});
