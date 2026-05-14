// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { AssignmentCollection } from "../AssignmentCollection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
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
    "data-testid": testId,
  }: {
    value?: string;
    onChange?: React.ChangeEventHandler<HTMLInputElement>;
    "data-testid"?: string;
  }) => (
    <input value={value ?? ""} onChange={onChange} data-testid={testId} />
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

describe("AssignmentCollection", () => {
  it("set operation keeps value and expression keys", () => {
    const onChange = vi.fn();
    render(
      <AssignmentCollection
        value={[{ key: "foo", operation: "set", value: "bar", expression: false }]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("param-assignments-value-0"), {
      target: { value: "baz" },
    });
    expect(onChange).toHaveBeenCalledWith([
      { key: "foo", operation: "set", value: "baz", expression: false },
    ]);
  });

  it("drop operation strips value/expression from row shape", () => {
    const onChange = vi.fn();
    render(
      <AssignmentCollection
        value={[{ key: "foo", operation: "set", value: "bar", expression: false }]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("param-assignments-op-0"), {
      target: { value: "drop" },
    });
    expect(onChange).toHaveBeenCalledWith([{ key: "foo", operation: "drop" }]);
  });

  it("adds a new row when Add is clicked", () => {
    const onChange = vi.fn();
    render(
      <AssignmentCollection value={[]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId("param-assignments-add"));
    expect(onChange).toHaveBeenCalledWith([
      { key: "", operation: "set", value: "", expression: false },
    ]);
  });
});
