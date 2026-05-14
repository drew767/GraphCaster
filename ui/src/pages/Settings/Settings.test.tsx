// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { changeLanguage: vi.fn(), language: "en" },
  }),
}));

vi.mock("../../stores/themeStore", () => ({
  useThemeStore: () => ({ theme: "auto", setTheme: vi.fn(), effective: () => "light" }),
}));

vi.mock("../../toast/ToastProvider", () => ({
  useToast: () => ({ toast: { show: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../i18n", () => ({
  default: { language: "en", changeLanguage: vi.fn() },
}));

import { AppRoutes } from "../../router/routes";

vi.mock("../../pages/Home/Home", () => ({ default: () => <div data-testid="home-view" /> }));
vi.mock("../../pages/Workflows/Workflows", () => ({ default: () => <div data-testid="workflows-view" /> }));
vi.mock("../../pages/Workflow/WorkflowEditor", () => ({ default: () => <div data-testid="workflow-editor" /> }));
vi.mock("../../pages/Executions/Executions", () => ({ default: () => <div data-testid="executions-view" /> }));
vi.mock("../../pages/Executions/SingleExecution", () => ({ default: () => <div data-testid="single-execution-view" /> }));
vi.mock("../../pages/Templates/TemplatesPage", () => ({ TemplatesPage: () => <div data-testid="templates-view" /> }));
vi.mock("../../pages/errors/NotFound", () => ({ default: () => <div data-testid="not-found" /> }));
vi.mock("../../pages/errors/EntityNotFound", () => ({ default: () => <div data-testid="entity-not-found" /> }));
vi.mock("../../pages/errors/Unauthorized", () => ({ default: () => <div data-testid="unauthorized" /> }));
vi.mock("../../pages/Auth/Signin", () => ({ default: () => <div data-testid="signin" /> }));
vi.mock("../../pages/Auth/Signup", () => ({ default: () => <div data-testid="signup" /> }));
vi.mock("../../pages/Auth/Signout", () => ({ default: () => <div data-testid="signout" /> }));
vi.mock("../../pages/Auth/ForgotPassword", () => ({ default: () => <div data-testid="forgot-password" /> }));
vi.mock("../../pages/Auth/ChangePassword", () => ({ default: () => <div data-testid="change-password" /> }));
vi.mock("../../pages/Auth/Setup", () => ({ default: () => <div data-testid="setup" /> }));
vi.mock("../../pages/Settings/ApiKeys", () => ({ default: () => <div data-testid="api-keys-page" /> }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe("Settings hub (UX51)", () => {
  it("renders sub-sidebar with all category links at /settings/personal", async () => {
    renderAt("/settings/personal");
    await waitFor(() => expect(screen.getByTestId("settings-sub-sidebar")).toBeInTheDocument());
    expect(screen.getByTestId("settings-nav-personal")).toBeInTheDocument();
    expect(screen.getByTestId("settings-nav-api-keys")).toBeInTheDocument();
    expect(screen.getByTestId("settings-nav-users")).toBeInTheDocument();
    expect(screen.getByTestId("settings-nav-external-secrets")).toBeInTheDocument();
    expect(screen.getByTestId("settings-nav-community-nodes")).toBeInTheDocument();
    expect(screen.getByTestId("settings-nav-source-control")).toBeInTheDocument();
    expect(screen.getByTestId("settings-nav-sso")).toBeInTheDocument();
    expect(screen.getByTestId("settings-nav-audit")).toBeInTheDocument();
    expect(screen.getByTestId("settings-nav-about")).toBeInTheDocument();
  });

  it("redirects /settings to /settings/personal", async () => {
    renderAt("/settings");
    await waitFor(() => expect(screen.getByTestId("personal-page")).toBeInTheDocument());
  });

  it("active nav item has active class for /settings/personal", async () => {
    renderAt("/settings/personal");
    await waitFor(() => expect(screen.getByTestId("settings-nav-personal")).toBeInTheDocument());
    const link = screen.getByTestId("settings-nav-personal");
    expect(link.className).toContain("active");
  });

  it("renders api-keys page at /settings/api-keys", async () => {
    renderAt("/settings/api-keys");
    await waitFor(() => expect(screen.getByTestId("api-keys-page")).toBeInTheDocument());
  });
});
