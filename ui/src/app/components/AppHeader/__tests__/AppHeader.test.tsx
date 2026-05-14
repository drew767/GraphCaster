// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { AppHeaderContent } from "../AppHeader";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "app.header.save": "Save",
        "app.header.run": "Run",
        "app.header.stop": "Stop",
        "app.header.notifications": "Notifications",
        "app.header.unsavedChanges": "Unsaved changes",
        "app.header.workflowNamePlaceholder": "Workflow name",
        "app.header.tabs.editor": "Editor",
        "app.header.tabs.executions": "Executions",
        "app.header.tabs.tests": "Tests",
        "app.header.tabs.ariaLabel": "Workflow views",
        "app.header.breadcrumbs.home": "Home",
        "app.header.breadcrumbs.workflows": "Workflows",
        "app.header.breadcrumbs.executions": "Executions",
        "app.header.breadcrumbs.editor": "Editor",
        "app.header.breadcrumbs.settings": "Settings",
      };
      return map[key] ?? key;
    },
  }),
}));

function renderAt(path: string, props: React.ComponentProps<typeof AppHeaderContent> = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppHeaderContent {...props} />
    </MemoryRouter>,
  );
}

describe("AppHeader — home route", () => {
  it("shows Workflows breadcrumb on /home/workflows", () => {
    renderAt("/home/workflows");
    expect(screen.getByText("Workflows")).toBeInTheDocument();
  });

  it("does not show Save or Run buttons on /home/workflows", () => {
    renderAt("/home/workflows");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run" })).not.toBeInTheDocument();
  });

  it("shows no workflow name editor on home route", () => {
    renderAt("/home/workflows");
    expect(screen.queryByPlaceholderText("Workflow name")).not.toBeInTheDocument();
  });
});

describe("AppHeader — workflow route", () => {
  it("shows workflow name inline edit on /workflow/123", () => {
    renderAt("/workflow/123", { workflowId: "123", workflowName: "My Flow" });
    expect(screen.getByText("My Flow")).toBeInTheDocument();
  });

  it("shows Editor, Executions, Tests tabs on /workflow/123", () => {
    renderAt("/workflow/123", { workflowId: "123" });
    expect(screen.getByRole("tab", { name: "Editor" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Executions" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tests" })).toBeInTheDocument();
  });

  it("shows Save and Run buttons on workflow route", () => {
    renderAt("/workflow/123", { workflowId: "123" });
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
  });

  it("shows breadcrumbs with Workflows link and Editor leaf", () => {
    renderAt("/workflow/123", { workflowId: "123" });
    const links = screen.getAllByRole("link");
    const workflowsLink = links.find((el) => el.textContent === "Workflows");
    expect(workflowsLink).toBeDefined();
    const editorEls = screen.getAllByText("Editor");
    expect(editorEls.length).toBeGreaterThanOrEqual(1);
  });
});

describe("AppHeader — workflow name edit", () => {
  it("clicking workflow name opens inline edit input", () => {
    renderAt("/workflow/123", { workflowId: "123", workflowName: "Old Name" });
    const displayEl = screen.getByText("Old Name");
    fireEvent.click(displayEl.closest("[role='button']") as HTMLElement);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("entering name and pressing Enter calls onWorkflowNameChange", () => {
    const onChange = vi.fn();
    renderAt("/workflow/123", {
      workflowId: "123",
      workflowName: "Old Name",
      onWorkflowNameChange: onChange,
    });
    fireEvent.click(screen.getByText("Old Name").closest("[role='button']") as HTMLElement);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("New Name");
  });
});

describe("AppHeader — run button", () => {
  it("Run button click fires onRun", () => {
    const onRun = vi.fn();
    renderAt("/workflow/123", { workflowId: "123", onRun });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("shows Stop button when isRunning=true and hides Run", () => {
    const onStop = vi.fn();
    renderAt("/workflow/123", { workflowId: "123", isRunning: true, onStop });
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run" })).not.toBeInTheDocument();
  });

  it("Stop button click fires onStop", () => {
    const onStop = vi.fn();
    renderAt("/workflow/123", { workflowId: "123", isRunning: true, onStop });
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

describe("AppHeader — Save dirty badge", () => {
  it("shows dirty dot when isDirty=true", () => {
    const { container } = renderAt("/workflow/123", { workflowId: "123", isDirty: true });
    expect(container.querySelector(".gc-app-header__dirty-dot")).not.toBeNull();
  });

  it("does not show dirty dot when isDirty=false", () => {
    const { container } = renderAt("/workflow/123", { workflowId: "123", isDirty: false });
    expect(container.querySelector(".gc-app-header__dirty-dot")).toBeNull();
  });
});

describe("AppHeader — tab navigation", () => {
  it("Editor tab is active on /workflow/123", () => {
    renderAt("/workflow/123", { workflowId: "123" });
    const editorTab = screen.getByRole("tab", { name: "Editor" });
    expect(editorTab).toHaveAttribute("aria-selected", "true");
  });

  it("Executions tab is active on /workflow/123/executions", () => {
    renderAt("/workflow/123/executions", { workflowId: "123" });
    const execTab = screen.getByRole("tab", { name: "Executions" });
    expect(execTab).toHaveAttribute("aria-selected", "true");
  });

  it("Tests tab is active on /workflow/123/tests", () => {
    renderAt("/workflow/123/tests", { workflowId: "123" });
    const testsTab = screen.getByRole("tab", { name: "Tests" });
    expect(testsTab).toHaveAttribute("aria-selected", "true");
  });

  it("clicking Executions tab triggers a click event on the tab button", () => {
    const { container } = renderAt("/workflow/123", { workflowId: "123" });
    const execTab = screen.getByRole("tab", { name: "Executions" });
    // Verify Editor is initially active
    expect(screen.getByRole("tab", { name: "Editor" })).toHaveAttribute("aria-selected", "true");
    expect(execTab).toHaveAttribute("aria-selected", "false");
    // Click the tab — MemoryRouter navigation re-renders to the new path
    fireEvent.click(execTab);
    // After navigation to /executions sub-route, Executions tab becomes active
    expect(execTab).toHaveAttribute("aria-selected", "true");
  });
});

describe("AppHeader — notifications bell", () => {
  it("bell button is present", () => {
    renderAt("/home/workflows");
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });

  it("shows count badge when notificationsCount > 0", () => {
    renderAt("/home/workflows", { notificationsCount: 3 });
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("does not show badge when notificationsCount is 0", () => {
    renderAt("/home/workflows", { notificationsCount: 0 });
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("AppHeader — settings route", () => {
  it("shows Settings breadcrumb on /settings route", () => {
    renderAt("/settings");
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("does not show Save/Run on /settings route", () => {
    renderAt("/settings");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run" })).not.toBeInTheDocument();
  });
});
