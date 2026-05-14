// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { FilterRuleBuilder, DEFAULT_FILTER_VALUE } from "../FilterRuleBuilder";

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

describe("FilterRuleBuilder", () => {
  it("adds a condition to an empty group", () => {
    const onChange = vi.fn();
    render(
      <FilterRuleBuilder value={DEFAULT_FILTER_VALUE} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId("filter-rule-add-condition-0"));
    expect(onChange).toHaveBeenCalled();
    const arg = onChange.mock.calls[0][0];
    expect(arg.rules.length).toBe(1);
    expect(arg.rules[0].operator).toBe("eq");
  });

  it("switches AND/OR combinator and emits updated value", () => {
    const onChange = vi.fn();
    render(
      <FilterRuleBuilder
        value={{ combinator: "and", rules: [] }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("filter-rule-combinator-0"), {
      target: { value: "or" },
    });
    expect(onChange).toHaveBeenCalledWith({ combinator: "or", rules: [] });
  });
});
