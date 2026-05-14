// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { JsonView } from "../JsonView";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "app.ndv.jsonView.searchPlaceholder": "Search…",
        "app.ndv.jsonView.searchAriaLabel": "Search JSON",
        "app.ndv.jsonView.filterMatches": "Filter matches",
        "app.ndv.jsonView.closeSearch": "Close search",
        "app.ndv.jsonView.noMatches": "No matches",
      };
      return map[key] ?? key;
    },
  }),
}));

describe("JsonView", () => {
  it("renders stringified JSON by default", () => {
    render(<JsonView data={{ name: "alice", age: 42 }} />);
    const pre = screen.getByTestId("json-view");
    expect(pre.textContent).toContain("alice");
    expect(pre.textContent).toContain("42");
  });

  it("opens search on Ctrl+F when container has focus", () => {
    render(<JsonView data={{ foo: "bar" }} />);
    const container = screen.getByTestId("json-view-container");
    expect(screen.queryByTestId("json-view-search")).toBeNull();

    act(() => {
      container.focus();
      const evt = new KeyboardEvent("keydown", {
        key: "f",
        ctrlKey: true,
        bubbles: true,
      });
      container.dispatchEvent(evt);
    });

    expect(screen.getByTestId("json-view-search")).toBeInTheDocument();
  });

  it("highlights matches when search query is entered", () => {
    render(<JsonView data={{ name: "alice", city: "wonderland" }} />);
    const container = screen.getByTestId("json-view-container");

    act(() => {
      container.focus();
      container.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });

    const input = screen.getByTestId("json-view-search-input");
    fireEvent.change(input, { target: { value: "alice" } });

    const marks = document.querySelectorAll(".gc-json-view__mark");
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0].textContent?.toLowerCase()).toContain("alice");
  });

  it("filter mode hides non-matching keys", () => {
    render(
      <JsonView
        data={{ name: "alice", city: "wonderland", age: 42 }}
      />,
    );
    const container = screen.getByTestId("json-view-container");
    act(() => {
      container.focus();
      container.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    const input = screen.getByTestId("json-view-search-input");
    fireEvent.change(input, { target: { value: "alice" } });
    fireEvent.click(screen.getByTestId("json-view-search-filter"));

    const pre = screen.getByTestId("json-view");
    expect(pre.textContent).toContain("alice");
    expect(pre.textContent).not.toContain("wonderland");
  });

  it("closes search on Escape", () => {
    render(<JsonView data={{ foo: "bar" }} />);
    const container = screen.getByTestId("json-view-container");
    act(() => {
      container.focus();
      container.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    const input = screen.getByTestId("json-view-search-input");
    fireEvent.change(input, { target: { value: "foo" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("json-view-search")).toBeNull();
  });
});
