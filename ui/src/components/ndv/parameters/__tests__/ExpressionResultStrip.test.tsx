// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "app.ndv.expression.resultLabel": "Result:",
      };
      return map[key] ?? key;
    },
  }),
}));

import { ExpressionResultStrip } from "../ExpressionResultStrip";

describe("ExpressionResultStrip", () => {
  it("renders nothing when value is not an expression", () => {
    const { container } = render(
      <ExpressionResultStrip value="plain text" context={{}} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("expression-result-strip")).toBeNull();
  });

  it("shows the resolved result for a valid expression", () => {
    render(
      <ExpressionResultStrip
        value="{{ $json.user.email }}"
        context={{ inputItem: { user: { email: "alice@example.com" } } }}
      />,
    );
    const strip = screen.getByTestId("expression-result-strip");
    expect(strip.textContent).toContain("Result:");
    expect(strip.textContent).toContain("alice@example.com");
    expect(strip.className).not.toContain("gc-expr-result--error");
  });

  it("shows an error for an unresolvable expression", () => {
    render(
      <ExpressionResultStrip
        value="{{ $json.missing }}"
        context={{ inputItem: {} }}
      />,
    );
    const strip = screen.getByTestId("expression-result-strip");
    expect(strip.className).toContain("gc-expr-result--error");
    expect(strip.textContent).toContain("⚠");
  });

  it("renders nothing for empty input", () => {
    const { container } = render(
      <ExpressionResultStrip value="" context={{}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
