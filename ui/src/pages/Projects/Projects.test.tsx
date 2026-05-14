// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";

import ProjectsView from "./Projects";

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

function makeProject(overrides: Partial<import("./Projects").ProjectSummary> = {}): import("./Projects").ProjectSummary {
  return {
    id: "proj-1",
    name: "Alpha Project",
    memberCount: 3,
    workflowCount: 5,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockFetch(data: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => data,
    }),
  );
}

function renderView() {
  return render(
    <MemoryRouter>
      <ProjectsView />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectsView", () => {
  it("renders page title and new button", async () => {
    mockFetch([]);
    renderView();
    await waitFor(() => expect(screen.queryByTestId("projects-loading")).not.toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByTestId("projects-page")).toBeInTheDocument();
    expect(screen.getByText("app.projects.title")).toBeInTheDocument();
    expect(screen.getAllByText("app.projects.newButton").length).toBeGreaterThanOrEqual(1);
  });

  it("shows empty state when API returns no projects", async () => {
    mockFetch([]);
    renderView();
    await waitFor(
      () => {
        expect(screen.getByTestId("projects-empty-state")).toBeInTheDocument();
        expect(screen.getByText("app.projects.emptyTitle")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("renders project cards when API returns data", async () => {
    mockFetch([
      makeProject({ name: "Alpha Project" }),
      makeProject({ id: "proj-2", name: "Beta Project" }),
    ]);
    renderView();
    await waitFor(() => expect(screen.getAllByTestId("project-card")).toHaveLength(2), { timeout: 3000 });
    expect(screen.getByText("Alpha Project")).toBeInTheDocument();
    expect(screen.getByText("Beta Project")).toBeInTheDocument();
  });

  it("navigates to project details on open click", async () => {
    mockFetch([makeProject({ id: "proj-42", name: "Alpha Project" })]);
    renderView();
    await waitFor(
      () => {
        expect(screen.getByTestId("project-card")).toBeInTheDocument();
        expect(screen.getByText("app.projects.actionOpen")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    const openBtn = screen.getByText("app.projects.actionOpen");
    fireEvent.click(openBtn);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/projects/proj-42"), { timeout: 2000 });
  });

  it("shows delete confirmation dialog on delete click", async () => {
    mockFetch([makeProject({ name: "Alpha Project" })]);
    renderView();
    await waitFor(() => expect(screen.getByTestId("project-card")).toBeInTheDocument(), { timeout: 3000 });
    const deleteBtn = screen.getByText("app.projects.actionDelete");
    fireEvent.click(deleteBtn);
    await waitFor(() =>
      expect(screen.getByText("app.projects.deleteTitle")).toBeInTheDocument(),
      { timeout: 3000 },
    );
  }, 10000);

  it("opens new project modal when + New project is clicked (empty state)", async () => {
    mockFetch([]);
    renderView();
    await waitFor(() =>
      expect(screen.getByTestId("projects-empty-state")).toBeInTheDocument(),
      { timeout: 3000 },
    );
    const headerBtn = screen.getByTestId("projects-new-button");
    fireEvent.click(headerBtn);
    await screen.findByTestId("projects-create-name", {}, { timeout: 3000 });
  }, 15000);

  it("filters cards by search query", async () => {
    mockFetch([
      makeProject({ id: "p1", name: "Alpha Project" }),
      makeProject({ id: "p2", name: "Beta Project" }),
    ]);
    renderView();
    await waitFor(() => expect(screen.getAllByTestId("project-card")).toHaveLength(2), { timeout: 3000 });
    const input = screen.getByTestId("projects-search-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Beta" } });
    await waitFor(() => expect(screen.getAllByTestId("project-card")).toHaveLength(1), { timeout: 2000 });
    expect(screen.getByText("Beta Project")).toBeInTheDocument();
  });
});
