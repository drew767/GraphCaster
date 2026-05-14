// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import ProjectDetails from "./ProjectDetails";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts) {
        return Object.entries(opts).reduce<string>(
          (s, [k, v]) => s.replace(`{{${k}}}`, String(v)),
          key,
        );
      }
      return key;
    },
  }),
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async (importActual) => {
  const actual = await importActual<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = "proj-123";

const PROJECT = {
  id: PROJECT_ID,
  name: "Test Project",
  description: "A sample project",
  memberCount: 2,
  createdAt: new Date().toISOString(),
};

const MEMBERS = [
  {
    userId: "u-1",
    name: "Alice",
    email: "alice@example.com",
    role: "admin",
    invitedAt: new Date().toISOString(),
  },
  {
    userId: "u-2",
    name: "Bob",
    email: "bob@example.com",
    role: "editor",
    invitedAt: new Date().toISOString(),
  },
];

const WORKFLOWS = [
  { id: "wf-1", name: "Daily Sync", active: true, updatedAt: new Date().toISOString() },
];

const CREDENTIALS = [
  { id: "cred-1", name: "OpenAI Key", type: "openai" },
];

const VARIABLES = [
  { key: "tenant.baseUrl", value: "https://example.com" },
];

const fetchMock = vi.fn();
global.fetch = fetchMock;

function setupFetchMock() {
  fetchMock.mockImplementation((url: string) => {
    if (typeof url === "string" && url.match(/\/projects\/[^/]+$/) && !url.includes("/members") && !url.includes("/workflows") && !url.includes("/credentials") && !url.includes("/variables")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => PROJECT });
    }
    if (typeof url === "string" && url.includes("/members") && !url.includes("/invite")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => MEMBERS });
    }
    if (typeof url === "string" && url.includes("/workflows")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => WORKFLOWS });
    }
    if (typeof url === "string" && url.includes("/credentials")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => CREDENTIALS });
    }
    if (typeof url === "string" && url.includes("/variables")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => VARIABLES });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
}

function renderDetails() {
  return render(
    <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}`]}>
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetails />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setupFetchMock();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectDetails", () => {
  it("renders project name after loading", async () => {
    renderDetails();
    await waitFor(() =>
      expect(screen.getByTestId("project-details-page")).toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(screen.getByText("Test Project")).toBeInTheDocument();
  });

  it("renders tabs for Members, Workflows, Credentials, Variables, Settings", async () => {
    renderDetails();
    await waitFor(() => expect(screen.getByTestId("project-details-page")).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText("app.projects.tabs.members")).toBeInTheDocument();
    expect(screen.getByText("app.projects.tabs.workflows")).toBeInTheDocument();
    expect(screen.getByText("app.projects.tabs.credentials")).toBeInTheDocument();
    expect(screen.getByText("app.projects.tabs.variables")).toBeInTheDocument();
    expect(screen.getByText("app.projects.tabs.settings")).toBeInTheDocument();
  });

  it("renders members in the Members tab", async () => {
    renderDetails();
    await waitFor(() => expect(screen.getByTestId("members-tab")).toBeInTheDocument(), { timeout: 3000 });
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("opens invite member modal on invite button click", async () => {
    renderDetails();
    await waitFor(() => expect(screen.getByTestId("members-tab")).toBeInTheDocument(), { timeout: 3000 });
    const inviteBtn = screen.getByText("app.projects.members.invite");
    await act(async () => { fireEvent.click(inviteBtn); });
    await waitFor(() => expect(screen.getByText("app.projects.inviteTitle")).toBeInTheDocument(), { timeout: 3000 });
  });

  it("renders workflows tab content", async () => {
    renderDetails();
    await waitFor(() => expect(screen.getByTestId("project-details-page")).toBeInTheDocument(), { timeout: 3000 });
    const workflowsTab = screen.getByRole("tab", { name: "app.projects.tabs.workflows" });
    await act(async () => { fireEvent.mouseDown(workflowsTab, { button: 0, ctrlKey: false }); });
    await waitFor(() => expect(screen.getByTestId("workflows-tab")).toBeInTheDocument(), { timeout: 3000 });
    await waitFor(() => expect(screen.getByText("Daily Sync")).toBeInTheDocument(), { timeout: 3000 });
  });

  it("renders settings tab with project name and delete button", async () => {
    renderDetails();
    await waitFor(() => expect(screen.getByTestId("project-details-page")).toBeInTheDocument(), { timeout: 3000 });
    const settingsTab = screen.getByRole("tab", { name: "app.projects.tabs.settings" });
    await act(async () => { fireEvent.mouseDown(settingsTab, { button: 0, ctrlKey: false }); });
    await waitFor(() => expect(screen.getByTestId("project-settings-tab")).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText("app.projects.settings.deleteButton")).toBeInTheDocument();
  });

  it("shows error state when API fails to load project", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    renderDetails();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it("inline-rename of project name calls PATCH API", async () => {
    renderDetails();
    await screen.findByTestId("project-name-inline-edit", {}, { timeout: 3000 });

    const wrap = screen.getByTestId("project-name-inline-edit");
    const trigger = wrap.querySelector('[role="button"]') as HTMLElement;
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(wrap.querySelector("input")).toBeTruthy();
    });
    const input = wrap.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed Project" } });
    fireEvent.blur(input);

    await waitFor(
      () => {
        const calls = fetchMock.mock.calls as unknown as Array<
          [string, RequestInit | undefined]
        >;
        const patchCall = calls.find(
          ([url, init]) =>
            typeof url === "string" &&
            url === `/api/v1/projects/${PROJECT_ID}` &&
            (init?.method ?? "GET") === "PATCH",
        );
        expect(patchCall).toBeTruthy();
        const body = JSON.parse(String(patchCall?.[1]?.body ?? "{}"));
        expect(body.name).toBe("Renamed Project");
      },
      { timeout: 5000 },
    );
  }, 15000);
});
