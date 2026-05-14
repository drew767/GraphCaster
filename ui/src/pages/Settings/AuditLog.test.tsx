// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import AuditLogPage from "./AuditLog";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const fetchMock = vi.fn();
global.fetch = fetchMock;

function makeEntry(overrides: Partial<import("./AuditLog").AuditEntry> = {}): import("./AuditLog").AuditEntry {
  return {
    id: "ae-1",
    timestamp: new Date().toISOString(),
    actor: { id: "u-1", name: "Alice" },
    action: "graph.create",
    targetKind: "graph",
    targetId: "gid-00000001",
    result: "success",
    ...overrides,
  };
}

function setupFetch(data: unknown, status = 200) {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuditLogPage", () => {
  it("renders page title", async () => {
    setupFetch({ items: [], total: 0 });
    render(<AuditLogPage />);
    expect(screen.getByTestId("audit-log-page")).toBeInTheDocument();
    expect(screen.getByText("app.settings.audit.title")).toBeInTheDocument();
  });

  it("shows empty state when API returns no entries", async () => {
    setupFetch({ items: [], total: 0 });
    render(<AuditLogPage />);
    await waitFor(() =>
      expect(screen.getByText("app.settings.audit.empty")).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it("renders audit entries in the table", async () => {
    setupFetch({
      items: [
        makeEntry({ action: "auth.login_success", actor: { id: "u-1", name: "Bob" } }),
        makeEntry({ id: "ae-2", action: "graph.delete", actor: { id: "u-2", name: "Carol" } }),
      ],
      total: 2,
    });
    render(<AuditLogPage />);
    await waitFor(() => expect(screen.getByText("Bob")).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText("Carol")).toBeInTheDocument();
    expect(screen.getByText("auth.login_success")).toBeInTheDocument();
    expect(screen.getByText("graph.delete")).toBeInTheDocument();
  });

  it("renders filter controls", async () => {
    setupFetch({ items: [], total: 0 });
    render(<AuditLogPage />);
    expect(screen.getByTestId("audit-filters")).toBeInTheDocument();
    expect(screen.getByLabelText("app.settings.audit.filterActor")).toBeInTheDocument();
  });

  it("shows export CSV and verify chain buttons", async () => {
    setupFetch({ items: [], total: 0 });
    render(<AuditLogPage />);
    expect(screen.getByText("app.settings.audit.exportCsv")).toBeInTheDocument();
    expect(screen.getByText("app.settings.audit.verifyChain")).toBeInTheDocument();
  });

  it("opens verify modal when verify chain button clicked", async () => {
    const verifyResponse = { ok: true, message: "Chain intact" };
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ items: [], total: 0 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => verifyResponse,
      });

    render(<AuditLogPage />);

    const verifyBtn = screen.getByText("app.settings.audit.verifyChain");
    await act(async () => {
      fireEvent.click(verifyBtn);
    });

    await waitFor(() =>
      expect(screen.getByText("app.settings.audit.verifyTitle")).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });
});
