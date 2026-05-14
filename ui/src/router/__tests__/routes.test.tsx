// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../routes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { changeLanguage: vi.fn() } }),
}));

vi.mock("../../pages/Workflow/WorkflowEditor", () => ({
  default: () => <div data-testid="workflow-editor">WorkflowEditor</div>,
}));

vi.mock("../../pages/Workflows/Workflows", () => ({
  default: () => <div data-testid="workflows-view">Workflows</div>,
}));

vi.mock("../../pages/Home/Home", () => ({
  default: () => <div data-testid="home-view">Home</div>,
}));

vi.mock("../../pages/Executions/Executions", () => ({
  default: () => <div data-testid="executions-view">Executions</div>,
}));

vi.mock("../../pages/Templates/TemplatesPage", () => ({
  TemplatesPage: () => <div data-testid="templates-view">Templates</div>,
}));

vi.mock("../../pages/errors/NotFound", () => ({
  default: () => <div data-testid="not-found">NotFound</div>,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe("AppRoutes", () => {
  it("renders WorkflowsView at /home/workflows", async () => {
    renderAt("/home/workflows");
    await waitFor(() => expect(screen.getByTestId("workflows-view")).toBeInTheDocument());
  });

  it("renders WorkflowEditorView at /workflow/some-id", async () => {
    renderAt("/workflow/some-id");
    await waitFor(() => expect(screen.getByTestId("workflow-editor")).toBeInTheDocument());
  });

  it("renders NotFoundView at /unknown", async () => {
    renderAt("/unknown");
    await waitFor(() => expect(screen.getByTestId("not-found")).toBeInTheDocument());
  });

  it("redirects / to /home/workflows", async () => {
    renderAt("/");
    await waitFor(() => expect(screen.getByTestId("workflows-view")).toBeInTheDocument());
  });
});
