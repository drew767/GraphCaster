// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
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

import { FieldModeToggle } from "../FieldModeToggle";
import { useNdvStore } from "../../useNdvStore";

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

describe("FieldModeToggle", () => {
  it("renders as fixed mode by default and shows `=`", () => {
    render(<FieldModeToggle paramKey="p1" />);
    const btn = screen.getByTestId("field-mode-toggle-p1");
    expect(btn.getAttribute("data-mode")).toBe("fixed");
    expect(btn.textContent).toBe("=");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("toggles store value to expression on click", () => {
    render(<FieldModeToggle paramKey="p1" />);
    const btn = screen.getByTestId("field-mode-toggle-p1");
    fireEvent.click(btn);
    expect(useNdvStore.getState().fieldMode["p1"]).toBe("expression");
  });

  it("renders ƒ in expression mode and toggles back to fixed", () => {
    act(() => {
      useNdvStore.getState().setFieldMode("p1", "expression");
    });
    render(<FieldModeToggle paramKey="p1" />);
    const btn = screen.getByTestId("field-mode-toggle-p1");
    expect(btn.textContent).toBe("ƒ");
    expect(btn.getAttribute("data-mode")).toBe("expression");
    fireEvent.click(btn);
    expect(useNdvStore.getState().fieldMode["p1"]).toBe("fixed");
  });

  it("persists field mode to localStorage", () => {
    render(<FieldModeToggle paramKey="p2" />);
    fireEvent.click(screen.getByTestId("field-mode-toggle-p2"));
    const raw = localStorage.getItem("gc.ndv.fieldMode");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.p2).toBe("expression");
  });
});
