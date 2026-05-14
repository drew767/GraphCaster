// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HomeView from "./Home";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function renderHome() {
  return render(
    <MemoryRouter>
      <HomeView />
    </MemoryRouter>
  );
}

describe("HomeView", () => {
  it("renders all three dashboard sections", () => {
    renderHome();
    expect(screen.getByText("app.home.recentWorkflows")).toBeInTheDocument();
    expect(screen.getByText("app.home.recentExecutions")).toBeInTheDocument();
    expect(screen.getByText("app.home.suggestedTemplates")).toBeInTheDocument();
  });

  it("renders the welcome heading", () => {
    renderHome();
    expect(screen.getByText("app.home.welcome")).toBeInTheDocument();
  });

  it("renders the create new workflow button", () => {
    renderHome();
    expect(screen.getByTestId("create-new-workflow")).toBeInTheDocument();
  });

  it("clicking create-new navigates to /workflow/new", async () => {
    mockNavigate.mockClear();
    renderHome();
    fireEvent.click(screen.getByTestId("create-new-workflow"));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/workflow/new");
    });
  });

  it("renders suggested template cards with use-template buttons", () => {
    renderHome();
    expect(screen.getByTestId("use-template-helloWorld")).toBeInTheDocument();
    expect(screen.getByTestId("use-template-httpTask")).toBeInTheDocument();
    expect(screen.getByTestId("use-template-llmSummarize")).toBeInTheDocument();
  });
});
