// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TemplatePreviewModal } from "../TemplatePreviewModal";
import type { TemplateMeta } from "../../../api/templates";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

const TEMPLATE: TemplateMeta = {
  id: "demo",
  name: "Demo template",
  description: "A demo.",
  author: { name: "Jane Doe" },
  categories: ["AI"],
  nodes: ["webhook", "ai.llm", "slack.message"],
  workflow: {
    nodes: [
      { id: "n1", type: "webhook", data: { label: "Webhook", description: "Listens" } },
      { id: "n2", type: "ai.llm", data: { label: "LLM" } },
    ],
    edges: [],
  },
  createdAt: "2026-01-01T00:00:00Z",
  views: 42,
};

describe("TemplatePreviewModal", () => {
  it("renders template name and author", () => {
    render(
      <TemplatePreviewModal template={TEMPLATE} onClose={vi.fn()} onUse={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { name: "Demo template" })).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
  });

  it("renders node list from workflow nodes", () => {
    render(
      <TemplatePreviewModal template={TEMPLATE} onClose={vi.fn()} onUse={vi.fn()} />,
    );
    const list = screen.getByTestId("preview-node-list");
    expect(list).toBeInTheDocument();
    expect(screen.getByText("Webhook")).toBeInTheDocument();
    expect(screen.getByText("LLM")).toBeInTheDocument();
    expect(screen.getByText("Listens")).toBeInTheDocument();
  });

  it("falls back to nodes[] strings when workflow has no nodes", () => {
    const fallback: TemplateMeta = { ...TEMPLATE, workflow: {} };
    render(
      <TemplatePreviewModal template={fallback} onClose={vi.fn()} onUse={vi.fn()} />,
    );
    expect(screen.getByText("webhook")).toBeInTheDocument();
    expect(screen.getByText("ai.llm")).toBeInTheDocument();
    expect(screen.getByText("slack.message")).toBeInTheDocument();
  });

  it("calls onUse with template when Use template button clicked", async () => {
    const onUse = vi.fn().mockResolvedValue(undefined);
    render(
      <TemplatePreviewModal template={TEMPLATE} onClose={vi.fn()} onUse={onUse} />,
    );
    fireEvent.click(screen.getByText("templates.useTemplate"));
    await waitFor(() => {
      expect(onUse).toHaveBeenCalledWith(TEMPLATE);
    });
  });

  it("renders View on hub link with template id", () => {
    render(
      <TemplatePreviewModal template={TEMPLATE} onClose={vi.fn()} onUse={vi.fn()} />,
    );
    const link = screen.getByText("templates.viewOnHub") as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.href).toContain("demo");
  });

  it("calls onClose when overlay clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <TemplatePreviewModal template={TEMPLATE} onClose={onClose} onUse={vi.fn()} />,
    );
    const overlay = container.querySelector(".gc-modal-overlay") as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });
});
