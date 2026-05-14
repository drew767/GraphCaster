// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { FixedCollectionParameter } from "../FixedCollectionParameter";
import type {
  FixedCollectionSection,
  FixedCollectionParameterProps,
} from "../FixedCollectionParameter";

/* ── i18n mock ─────────────────────────────────────────────────────── */

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === "app.ndv.fixedCollection.add" && params?.name) {
        return `Add ${params.name}`;
      }
      const map: Record<string, string> = {
        "app.ndv.fixedCollection.remove": "Remove",
        "app.ndv.fixedCollection.jsonPlaceholder": "Enter JSON…",
      };
      return map[key] ?? key;
    },
  }),
}));

/* ── Accordion mock (our UI component) ───────────────────────────── */

vi.mock("../../../ui/Accordion/Accordion", () => ({
  Accordion: ({
    items,
    defaultValue,
  }: {
    items: Array<{ id: string; title: React.ReactNode; content: React.ReactNode }>;
    defaultValue?: string[];
    type?: string;
    className?: string;
  }) => {
    const [openIds, setOpenIds] = React.useState<string[]>(defaultValue ?? []);
    return (
      <div data-testid="accordion">
        {items.map((item) => {
          const isOpen = openIds.includes(item.id);
          return (
            <div key={item.id} data-testid={`accordion-item-${item.id}`}>
              <button
                data-testid={`accordion-trigger-${item.id}`}
                onClick={() =>
                  setOpenIds((ids) =>
                    ids.includes(item.id)
                      ? ids.filter((i) => i !== item.id)
                      : [...ids, item.id],
                  )
                }
              >
                {item.title}
              </button>
              {isOpen && (
                <div data-testid={`accordion-content-${item.id}`}>
                  {item.content}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  },
}));

/* ── Icon mock ────────────────────────────────────────────────────── */

vi.mock("../../../ui/Icon/Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
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

const optionsSectionDef: FixedCollectionSection = {
  name: "options",
  displayName: "Options",
  description: "Advanced options",
  fields: [
    { name: "limit", displayName: "Limit", type: "number" },
    { name: "sortBy", displayName: "Sort by", type: "string" },
  ],
};

const authSectionDef: FixedCollectionSection = {
  name: "auth",
  displayName: "Auth",
  fields: [{ name: "token", displayName: "Token", type: "string" }],
  defaultValue: { token: "" },
};

const allSections = [optionsSectionDef, authSectionDef];

function renderFixed(props: Partial<FixedCollectionParameterProps> = {}) {
  const defaults: FixedCollectionParameterProps = {
    value: {},
    onChange: vi.fn(),
    sections: allSections,
  };
  return render(<FixedCollectionParameter {...defaults} {...props} />);
}

/* ── tests ─────────────────────────────────────────────────────────── */

describe("FixedCollectionParameter", () => {
  it("renders Add buttons for all inactive sections", () => {
    renderFixed({ value: {} });
    expect(
      screen.getByTestId("fixed-collection-add-options"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("fixed-collection-add-auth"),
    ).toBeInTheDocument();
  });

  it("shows accordion item for active section and not for inactive", () => {
    renderFixed({ value: { options: { limit: 10 } } });
    expect(screen.getByTestId("accordion-item-options")).toBeInTheDocument();
    expect(
      screen.queryByTestId("accordion-item-auth"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("fixed-collection-add-auth"),
    ).toBeInTheDocument();
  });

  it("calls onChange when Add button is clicked", () => {
    const onChange = vi.fn();
    renderFixed({ value: {}, onChange });
    fireEvent.click(screen.getByTestId("fixed-collection-add-options"));
    expect(onChange).toHaveBeenCalledWith({ options: {} });
  });

  it("uses defaultValue when adding a section", () => {
    const onChange = vi.fn();
    renderFixed({ value: {}, onChange });
    fireEvent.click(screen.getByTestId("fixed-collection-add-auth"));
    expect(onChange).toHaveBeenCalledWith({ auth: { token: "" } });
  });

  it("fills fields in an active section", () => {
    const onChange = vi.fn();
    renderFixed({
      value: { options: { limit: 10, sortBy: "" } },
      onChange,
    });
    const sortByInput = screen.getByTestId("fixed-collection-field-sortBy");
    fireEvent.change(sortByInput, { target: { value: "name" } });
    expect(onChange).toHaveBeenCalledWith({
      options: { limit: 10, sortBy: "name" },
    });
  });

  it("calls onChange with section removed when Remove is clicked", () => {
    const onChange = vi.fn();
    renderFixed({
      value: { options: { limit: 5 } },
      onChange,
    });
    const removeBtn = screen.getByTestId("fixed-collection-remove-options");
    fireEvent.click(removeBtn);
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("renders section description when present", () => {
    renderFixed({ value: { options: {} } });
    expect(screen.getByText("Advanced options")).toBeInTheDocument();
  });
});
