// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { CollectionParameter } from "../CollectionParameter";
import type { CollectionItemSchema, CollectionParameterProps } from "../CollectionParameter";

/* ── i18n mock ─────────────────────────────────────────────────────── */

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "app.ndv.collection.addItem": "Add item",
        "app.ndv.collection.removeItem": "Remove item",
        "app.ndv.collection.item": "Item",
        "app.ndv.collection.jsonPlaceholder": "Enter JSON…",
      };
      return map[key] ?? key;
    },
  }),
}));

/* ── Collapsible UI component mock ─────────────────────────────────── */

vi.mock("../../../ui/Collapsible/Collapsible", () => ({
  Collapsible: ({
    trigger,
    children,
    defaultOpen,
  }: {
    trigger: React.ReactNode;
    children: React.ReactNode;
    defaultOpen?: boolean;
  }) => {
    const [open, setOpen] = React.useState(defaultOpen ?? false);
    return (
      <div>
        <button
          data-testid="collapsible-trigger"
          onClick={() => setOpen((o) => !o)}
        >
          {trigger}
        </button>
        {open && <div data-testid="collapsible-content">{children}</div>}
      </div>
    );
  },
}));

/* ── Button mock ──────────────────────────────────────────────────── */

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

/* ── Select mock ──────────────────────────────────────────────────── */

vi.mock("../../../ui/Select/Select", () => ({
  Select: ({
    value,
    onValueChange,
    options,
    disabled,
    "aria-label": ariaLabel,
    "data-testid": testId,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    options: Array<{ value: string; label: string }>;
    disabled?: boolean;
    "aria-label"?: string;
    "data-testid"?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value ?? ""}
      disabled={disabled}
      data-testid={testId}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

/* ── Switch mock ──────────────────────────────────────────────────── */

vi.mock("../../../ui/Switch/Switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
    label,
    "data-testid": testId,
  }: {
    checked?: boolean;
    onCheckedChange?: (v: boolean) => void;
    disabled?: boolean;
    label?: string;
    "data-testid"?: string;
  }) => (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked ?? false}
      disabled={disabled}
      data-testid={testId}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
    />
  ),
}));

/* ── Input mock ───────────────────────────────────────────────────── */

vi.mock("../../../ui/Input/Input", () => ({
  Input: ({
    value,
    onChange,
    disabled,
    "aria-label": ariaLabel,
    "data-testid": testId,
  }: {
    value?: string;
    onChange?: React.ChangeEventHandler<HTMLInputElement>;
    disabled?: boolean;
    "aria-label"?: string;
    "data-testid"?: string;
  }) => (
    <input
      aria-label={ariaLabel}
      value={value ?? ""}
      disabled={disabled}
      data-testid={testId}
      onChange={onChange}
    />
  ),
}));

/* ── InputNumber mock ─────────────────────────────────────────────── */

vi.mock("../../../ui/InputNumber/InputNumber", () => ({
  InputNumber: ({
    value,
    onChange,
    disabled,
    "aria-label": ariaLabel,
    "data-testid": testId,
  }: {
    value?: number;
    onChange?: (v: number | null) => void;
    disabled?: boolean;
    "aria-label"?: string;
    "data-testid"?: string;
  }) => (
    <input
      type="number"
      aria-label={ariaLabel}
      value={value ?? ""}
      disabled={disabled}
      data-testid={testId}
      onChange={(e) =>
        onChange?.(e.target.value === "" ? null : Number(e.target.value))
      }
    />
  ),
}));

/* ── helpers ──────────────────────────────────────────────────────── */

const nameSchema: CollectionItemSchema[] = [
  { name: "firstName", displayName: "First Name", type: "string" },
  { name: "age", displayName: "Age", type: "number" },
];

function renderCollection(props: Partial<CollectionParameterProps> = {}) {
  const defaults: CollectionParameterProps = {
    value: [],
    onChange: vi.fn(),
    itemSchema: nameSchema,
  };
  return render(<CollectionParameter {...defaults} {...props} />);
}

/* ── tests ─────────────────────────────────────────────────────────── */

describe("CollectionParameter", () => {
  it("renders empty list without items", () => {
    renderCollection({ value: [] });
    expect(screen.getByTestId("collection-parameter")).toBeInTheDocument();
    expect(screen.queryByTestId("collection-item-0")).not.toBeInTheDocument();
  });

  it("shows Add item button", () => {
    renderCollection({ value: [] });
    expect(screen.getByTestId("collection-add-button")).toBeInTheDocument();
    expect(screen.getByTestId("collection-add-button")).toHaveTextContent(
      "Add item",
    );
  });

  it("calls onChange with new item when Add item is clicked", () => {
    const onChange = vi.fn();
    renderCollection({ value: [], onChange });
    fireEvent.click(screen.getByTestId("collection-add-button"));
    expect(onChange).toHaveBeenCalledWith([{}]);
  });

  it("renders existing items", () => {
    const value = [
      { firstName: "Alice", age: 30 },
      { firstName: "Bob", age: 25 },
    ];
    renderCollection({ value });
    expect(screen.getByTestId("collection-item-0")).toBeInTheDocument();
    expect(screen.getByTestId("collection-item-1")).toBeInTheDocument();
  });

  it("removes an item when remove button is clicked", () => {
    const onChange = vi.fn();
    const value = [{ firstName: "Alice" }, { firstName: "Bob" }];
    renderCollection({ value, onChange });
    fireEvent.click(screen.getByTestId("collection-remove-0"));
    expect(onChange).toHaveBeenCalledWith([{ firstName: "Bob" }]);
  });

  it("expands and collapses item content via trigger", () => {
    renderCollection({ value: [{ firstName: "Alice" }] });
    const trigger = screen.getByTestId("collapsible-trigger");
    fireEvent.click(trigger);
    expect(screen.queryByTestId("collapsible-content")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByTestId("collapsible-content")).toBeInTheDocument();
  });

  it("disables Add item button when maxItems is reached", () => {
    renderCollection({ value: [{ firstName: "A" }], maxItems: 1 });
    expect(screen.getByTestId("collection-add-button")).toBeDisabled();
  });

  it("calls onChange when a field value changes", () => {
    const onChange = vi.fn();
    const value = [{ firstName: "Alice", age: 30 }];
    renderCollection({ value, onChange });
    const input = screen.getByTestId("collection-field-firstName");
    fireEvent.change(input, { target: { value: "Charlie" } });
    expect(onChange).toHaveBeenCalledWith([{ firstName: "Charlie", age: 30 }]);
  });

  it("uses custom itemDisplayName when provided", () => {
    const value = [{ firstName: "Alice" }];
    const itemDisplayName = (
      _item: Record<string, unknown>,
      idx: number,
    ) => `Custom Name ${idx}`;
    renderCollection({ value, itemDisplayName });
    expect(screen.getByText("Custom Name 0")).toBeInTheDocument();
  });
});
