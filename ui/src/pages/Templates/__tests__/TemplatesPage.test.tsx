// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TemplatesPage } from "../TemplatesPage";
import { __clearTemplateCache } from "../../../api/templates";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

beforeEach(() => {
  __clearTemplateCache();
});

describe("TemplatesPage", () => {
  it("renders template cards from local fallback", async () => {
    render(<TemplatesPage />);
    await waitFor(() => {
      expect(
        screen.getByText("Summarize documents with AI"),
      ).toBeInTheDocument();
    });
  });

  it("shows category facets with counts", async () => {
    render(<TemplatesPage />);
    await waitFor(() => screen.getByText("Summarize documents with AI"));
    // AI category exists in multiple templates
    const aiCheckbox = screen.getByRole("checkbox", { name: "AI" });
    expect(aiCheckbox).toBeInTheDocument();
  });

  it("clicking a facet filters the list", async () => {
    render(<TemplatesPage />);
    await waitFor(() => screen.getByText("Summarize documents with AI"));
    const marketingCheckbox = screen.getByRole("checkbox", { name: "Marketing" });
    fireEvent.click(marketingCheckbox);
    await waitFor(() => {
      // Marketing template visible
      expect(screen.getByText("Weekly newsletter sender")).toBeInTheDocument();
      // Non-Marketing AI template hidden
      expect(
        screen.queryByText("Summarize documents with AI"),
      ).not.toBeInTheDocument();
    });
  });

  it("clear filters resets active categories", async () => {
    render(<TemplatesPage />);
    await waitFor(() => screen.getByText("Summarize documents with AI"));
    const marketingCheckbox = screen.getByRole("checkbox", { name: "Marketing" });
    fireEvent.click(marketingCheckbox);
    await waitFor(() => {
      expect(
        screen.queryByText("Summarize documents with AI"),
      ).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("templates.clearFilters"));
    await waitFor(() => {
      expect(
        screen.getByText("Summarize documents with AI"),
      ).toBeInTheDocument();
    });
  });

  it("opens preview modal when card preview button is clicked", async () => {
    render(<TemplatesPage />);
    await waitFor(() => screen.getByText("Summarize documents with AI"));
    const previewButtons = screen.getAllByText("templates.preview");
    fireEvent.click(previewButtons[0]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("clicking Use template on card triggers onCreateFromTemplate", async () => {
    const onCreate = vi.fn();
    render(<TemplatesPage onCreateFromTemplate={onCreate} />);
    await waitFor(() => screen.getAllByText("templates.useTemplate"));
    const useButtons = screen.getAllByText("templates.useTemplate");
    fireEvent.click(useButtons[0]);
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalled();
    });
  });
});
