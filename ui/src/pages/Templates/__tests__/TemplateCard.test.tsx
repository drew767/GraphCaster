// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TemplateCard } from "../TemplateCard";
import type { TemplateMeta } from "../../../api/templates";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

const MOCK_TEMPLATE: TemplateMeta = {
  id: "hello-world",
  name: "Hello World",
  description: "A minimal starter graph.",
  author: { name: "GraphCaster Team" },
  categories: ["AI", "Demo"],
  nodes: ["http.request", "ai.llm"],
  workflow: { nodes: [], edges: [] },
  createdAt: "2026-01-01T00:00:00Z",
  views: 1234,
  tags: ["starter"],
};

describe("TemplateCard", () => {
  it("renders name and description", () => {
    render(
      <TemplateCard template={MOCK_TEMPLATE} onPreview={vi.fn()} onUse={vi.fn()} />,
    );
    expect(screen.getByText("Hello World")).toBeInTheDocument();
    expect(screen.getByText("A minimal starter graph.")).toBeInTheDocument();
  });

  it("renders author name", () => {
    render(
      <TemplateCard template={MOCK_TEMPLATE} onPreview={vi.fn()} onUse={vi.fn()} />,
    );
    expect(screen.getByText("GraphCaster Team")).toBeInTheDocument();
  });

  it("renders category chips", () => {
    render(
      <TemplateCard template={MOCK_TEMPLATE} onPreview={vi.fn()} onUse={vi.fn()} />,
    );
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("Demo")).toBeInTheDocument();
  });

  it("renders cover image when provided", () => {
    const withImg: TemplateMeta = { ...MOCK_TEMPLATE, coverUrl: "/img/test.png" };
    render(
      <TemplateCard template={withImg} onPreview={vi.fn()} onUse={vi.fn()} />,
    );
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "/img/test.png");
  });

  it("does not render img when coverUrl is missing", () => {
    render(
      <TemplateCard template={MOCK_TEMPLATE} onPreview={vi.fn()} onUse={vi.fn()} />,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("calls onPreview when preview button clicked", () => {
    const onPreview = vi.fn();
    render(
      <TemplateCard template={MOCK_TEMPLATE} onPreview={onPreview} onUse={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("templates.preview"));
    expect(onPreview).toHaveBeenCalledWith(MOCK_TEMPLATE);
  });

  it("calls onUse when use template button clicked", () => {
    const onUse = vi.fn();
    render(
      <TemplateCard template={MOCK_TEMPLATE} onPreview={vi.fn()} onUse={onUse} />,
    );
    fireEvent.click(screen.getByText("templates.useTemplate"));
    expect(onUse).toHaveBeenCalledWith(MOCK_TEMPLATE);
  });
});
