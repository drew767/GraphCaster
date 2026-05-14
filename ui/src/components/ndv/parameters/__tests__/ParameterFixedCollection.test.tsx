// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ParameterFixedCollection } from "../ParameterFixedCollection";
import type {
  FixedCollectionSectionDef,
  FixedCollectionValue,
} from "../ParameterFixedCollection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === "app.ndv.parameters.types.fixedCollection.addInstance" && params?.name) {
        return `Add ${params.name}`;
      }
      const map: Record<string, string> = {
        "app.ndv.parameters.types.fixedCollection.removeInstance": "Remove",
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock("../../../ui/Accordion/Accordion", () => ({
  Accordion: ({
    items,
  }: {
    items: Array<{ id: string; title: React.ReactNode; content: React.ReactNode }>;
  }) => (
    <div>
      {items.map((item) => (
        <div key={item.id} data-testid={`section-${item.id}`}>
          <div>{item.title}</div>
          <div>{item.content}</div>
        </div>
      ))}
    </div>
  ),
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
    <input
      value={value ?? ""}
      onChange={onChange}
      data-testid={testId}
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
      onChange={(e) => onChange?.(e.target.value === "" ? null : Number(e.target.value))}
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

describe("ParameterFixedCollection", () => {
  it("renders section children", () => {
    const sections: FixedCollectionSectionDef[] = [
      {
        name: "main",
        displayName: "Main",
        children: [
          { name: "title", label: "Title", type: "string", defaultValue: "" },
        ],
      },
    ];
    render(
      <ParameterFixedCollection
        value={{ main: { title: "x" } }}
        onChange={() => {}}
        sections={sections}
      />,
    );
    expect(screen.getByTestId("section-main")).toBeInTheDocument();
    const input = screen.getByTestId(
      "param-fixed-collection-main-field-title",
    ) as HTMLInputElement;
    expect(input.value).toBe("x");
  });

  it("supports multiple=true with add and remove", () => {
    const sections: FixedCollectionSectionDef[] = [
      {
        name: "items",
        displayName: "Items",
        multiple: true,
        children: [
          { name: "title", label: "Title", type: "string", defaultValue: "" },
        ],
      },
    ];
    const onChange = vi.fn();
    const value: FixedCollectionValue = { items: [{ title: "a" }] };
    render(
      <ParameterFixedCollection
        value={value}
        onChange={onChange}
        sections={sections}
      />,
    );

    fireEvent.click(screen.getByTestId("param-fixed-collection-items-add"));
    expect(onChange).toHaveBeenCalledWith({
      items: [{ title: "a" }, { title: "" }],
    });
  });
});
