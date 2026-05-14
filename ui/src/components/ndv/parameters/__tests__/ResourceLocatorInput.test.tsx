// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

import {
  ResourceLocatorInput,
  extractIdFromUrl,
} from "../ResourceLocatorInput";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../../ui/Select/Select", () => ({
  Select: <T extends string>(props: {
    value: T;
    onValueChange?: (v: T) => void;
    options: Array<{ value: T; label: string }>;
    "data-testid"?: string;
  }) => (
    <select
      data-testid={props["data-testid"] ?? "select"}
      value={props.value}
      onChange={(e) => props.onValueChange?.(e.target.value as T)}
    >
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("../../../ui/Input/Input", () => ({
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    function Input(props, ref) {
      return <input ref={ref} {...props} />;
    },
  ),
}));

vi.mock("../../../ui/Spinner/Spinner", () => ({
  Spinner: () => <span data-testid="spinner" />,
}));

vi.mock("../../../ui/Icon/Icon", () => ({
  Icon: () => <span />,
}));

describe("extractIdFromUrl", () => {
  it("returns url when no extractor", () => {
    expect(extractIdFromUrl("https://example.com/x")).toBe("https://example.com/x");
  });

  it("extracts capture group 1", () => {
    expect(
      extractIdFromUrl("https://example.com/items/42/show", "items/(\\d+)"),
    ).toBe("42");
  });

  it("falls back to original on bad regex", () => {
    expect(extractIdFromUrl("https://x.test", "[")).toBe("https://x.test");
  });
});

describe("ResourceLocatorInput", () => {
  it("renders all three modes", () => {
    render(
      <ResourceLocatorInput
        schema={{ type: "resourceLocator", modes: ["list", "id", "url"] }}
        value={{ mode: "id", value: "abc" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("rl-input-mode-chip")).toBeInTheDocument();
    expect(screen.getByTestId("rl-input-id")).toHaveValue("abc");
  });

  it("switches mode via chip", () => {
    const onChange = vi.fn();
    render(
      <ResourceLocatorInput
        schema={{ type: "resourceLocator", modes: ["list", "id", "url"] }}
        value={{ mode: "id", value: "abc" }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("rl-input-mode-chip"), {
      target: { value: "url" },
    });
    expect(onChange).toHaveBeenCalledWith({ mode: "url", value: "" });
  });

  it("applies urlExtractor on blur", () => {
    const onChange = vi.fn();
    render(
      <ResourceLocatorInput
        schema={{
          type: "resourceLocator",
          modes: ["url"],
          urlExtractor: "items/(\\d+)",
        }}
        value={{ mode: "url", value: "" }}
        onChange={onChange}
      />,
    );
    const input = screen.getByTestId("rl-input-url") as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: "https://x.test/items/123/details" },
    });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith({ mode: "url", value: "123" });
  });

  it("debounces optionsLoader and shows results in list mode", async () => {
    vi.useFakeTimers();
    const loader = vi.fn().mockResolvedValue([
      { value: "1", label: "First" },
      { value: "2", label: "Second" },
    ]);
    const onChange = vi.fn();
    render(
      <ResourceLocatorInput
        schema={{
          type: "resourceLocator",
          modes: ["list"],
          optionsLoader: loader,
        }}
        value={{ mode: "list", value: "" }}
        onChange={onChange}
      />,
    );

    // Initial debounce fires (empty query)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(260);
    });
    expect(loader).toHaveBeenCalledWith("");

    fireEvent.change(screen.getByTestId("rl-input-list-search"), {
      target: { value: "foo" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(260);
    });
    expect(loader).toHaveBeenLastCalledWith("foo");
    vi.useRealTimers();

    await waitFor(() => {
      expect(screen.getByTestId("rl-input-option-1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("rl-input-option-1"));
    expect(onChange).toHaveBeenCalledWith({ mode: "list", value: "1" });
  });
});
