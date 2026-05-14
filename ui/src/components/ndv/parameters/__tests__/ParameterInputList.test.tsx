// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ParameterInputList } from "../ParameterInputList";
import type { ParameterField } from "../ParameterInputList";

/* ── i18n mock ──────────────────────────────────────────────────────── */

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        "app.help.openDocs": "Open docs",
        "app.help.learnMore": "Learn more",
        "app.help.example": "Example",
        "app.ndv.parameters.learnMore": "Learn more",
        "app.ndv.validation.required": "This field is required",
      };
      if (params && Object.keys(params).length) {
        return `${map[key] ?? key}:${JSON.stringify(params)}`;
      }
      return map[key] ?? key;
    },
  }),
}));

/* ── InfoTip mock — render children inline so they're queryable ───── */

vi.mock("../../../ui/InfoTip/InfoTip", () => ({
  InfoTip: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="info-tip">{children}</span>
  ),
}));

/* ── Popover mock ───────────────────────────────────────────────────── */

vi.mock("../../../ui/Popover/Popover", () => ({
  Popover: ({
    trigger,
    children,
    open,
    onOpenChange,
  }: {
    trigger: React.ReactElement;
    children: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => {
    return (
      <div>
        {React.cloneElement(trigger, {
          onClick: () => onOpenChange?.(!open),
        })}
        {open && <div data-testid="popover-content">{children}</div>}
      </div>
    );
  },
}));

/* ── Button mock ─────────────────────────────────────────────────────── */

vi.mock("../../../ui/Button/Button", () => ({
  Button: React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement> & { "aria-label"?: string; "data-testid"?: string }
  >((props, ref) => <button ref={ref} {...props} />),
}));

/* ── ResourceLocator mock ───────────────────────────────────────────── */

vi.mock("../ResourceLocator/ResourceLocator", () => ({
  ResourceLocator: () => <div data-testid="resource-locator" />,
}));

/* ── CollectionParameter mock ────────────────────────────────────────── */

vi.mock("../CollectionParameter", () => ({
  CollectionParameter: () => <div data-testid="collection-parameter" />,
}));

/* ── FixedCollectionParameter mock ───────────────────────────────────── */

vi.mock("../FixedCollectionParameter", () => ({
  FixedCollectionParameter: () => <div data-testid="fixed-collection-parameter" />,
}));

/* ── Helpers ─────────────────────────────────────────────────────────── */

const baseField: ParameterField = {
  name: "myField",
  type: "string",
  label: "My Field",
};

function renderList(fields: ParameterField[], values: Record<string, unknown> = {}) {
  return render(
    <ParameterInputList
      fields={fields}
      values={values}
      onChange={() => {}}
    />,
  );
}

/* ── Tests ───────────────────────────────────────────────────────────── */

describe("ParameterInputList — inline help icon", () => {
  it("does not render help button when field has no help metadata", () => {
    renderList([baseField]);
    expect(screen.queryByTestId("help-trigger-myField")).toBeNull();
  });

  it("renders help button (ⓘ) when field has help.description", () => {
    const field: ParameterField = {
      ...baseField,
      help: { description: "This field accepts a string value." },
    };
    renderList([field]);
    const btn = screen.getByTestId("help-trigger-myField");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-label", "Open docs");
  });
});

describe("ParameterInputList — popover opens on click", () => {
  it("opens popover when help button is clicked", () => {
    const field: ParameterField = {
      ...baseField,
      help: { description: "A detailed description of the parameter." },
    };
    renderList([field]);

    expect(screen.queryByTestId("popover-content")).toBeNull();

    const btn = screen.getByTestId("help-trigger-myField");
    fireEvent.click(btn);

    expect(screen.getByTestId("popover-content")).toBeInTheDocument();
    expect(screen.getByText("A detailed description of the parameter.")).toBeInTheDocument();
  });
});

describe("ParameterInputList — docs link present", () => {
  it("renders a docs link when docsUrl is provided", () => {
    const field: ParameterField = {
      ...baseField,
      help: {
        description: "See docs for details.",
        docsUrl: "https://docs.graphcaster.io/params/myField",
        example: "hello world",
      },
    };
    renderList([field]);

    const btn = screen.getByTestId("help-trigger-myField");
    fireEvent.click(btn);

    const link = screen.getByTestId("help-docs-link-myField");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "https://docs.graphcaster.io/params/myField");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });
});

describe("ParameterInputList — description info tooltip", () => {
  it("renders InfoTip when field has description", () => {
    const field: ParameterField = {
      ...baseField,
      description: "Inline help text",
    };
    renderList([field]);
    expect(screen.getByTestId("description-tip-myField")).toBeInTheDocument();
    expect(screen.getByText("Inline help text")).toBeInTheDocument();
  });

  it("does not render InfoTip when description is absent", () => {
    renderList([baseField]);
    expect(screen.queryByTestId("description-tip-myField")).toBeNull();
  });

  it("appends a Learn more link when docsUrl is provided", () => {
    const field: ParameterField = {
      ...baseField,
      description: "Inline help text",
      docsUrl: "https://example.com/docs",
    };
    renderList([field]);
    const link = screen.getByTestId("description-tip-link-myField");
    expect(link).toHaveAttribute("href", "https://example.com/docs");
  });
});

describe("ParameterInputList — conditional display", () => {
  it("hides a field whose show rule does not match", () => {
    const fields: ParameterField[] = [
      { name: "mode", type: "string", label: "Mode" },
      {
        name: "child",
        type: "string",
        label: "Child",
        displayOptions: { show: { mode: ["advanced"] } },
      },
    ];
    renderList(fields, { mode: "basic" });
    expect(screen.queryByTestId("parameter-row-child")).toBeNull();
    expect(screen.getByTestId("parameter-row-mode")).toBeInTheDocument();
  });

  it("shows a field whose show rule matches", () => {
    const fields: ParameterField[] = [
      { name: "mode", type: "string", label: "Mode" },
      {
        name: "child",
        type: "string",
        label: "Child",
        displayOptions: { show: { mode: ["advanced"] } },
      },
    ];
    renderList(fields, { mode: "advanced" });
    expect(screen.getByTestId("parameter-row-child")).toBeInTheDocument();
  });
});

describe("ParameterInputList — required validation on blur", () => {
  it("shows error only after blur", () => {
    const field: ParameterField = {
      ...baseField,
      required: true,
    };
    renderList([field], { myField: "" });

    expect(screen.queryByTestId("form-error-myField")).toBeNull();

    const row = screen.getByTestId("parameter-row-myField");
    fireEvent.blur(row);

    expect(screen.getByTestId("form-error-myField")).toBeInTheDocument();
  });

  it("does not show error when value is non-empty", () => {
    const field: ParameterField = {
      ...baseField,
      required: true,
    };
    renderList([field], { myField: "hello" });
    const row = screen.getByTestId("parameter-row-myField");
    fireEvent.blur(row);
    expect(screen.queryByTestId("form-error-myField")).toBeNull();
  });
});
