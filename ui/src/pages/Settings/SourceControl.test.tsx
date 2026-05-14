// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (opts) {
        let result = k;
        Object.entries(opts).forEach(([key, val]) => {
          result = result.replace(`{{${key}}}`, String(val));
        });
        return result;
      }
      return k;
    },
  }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import SourceControlPage from "./SourceControl";

function renderPage() {
  return render(
    <MemoryRouter>
      <SourceControlPage />
    </MemoryRouter>,
  );
}

describe("SourceControl settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockFetch.mockResolvedValue({
      status: 404,
      ok: false,
      json: async () => ({}),
    });
  });

  it("renders the page root element", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("source-control-page")).toBeInTheDocument();
    });
  });

  it("shows disconnected badge when backend returns 404", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("sc-status-badge")).toHaveTextContent(
        "app.settings.sourceControl.statusDisconnected",
      );
    });
  });

  it("shows the connect card when disconnected", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("sc-connect-card")).toBeInTheDocument();
    });
  });

  it("shows backend-missing notice when API returns 404", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("sc-backend-missing")).toBeInTheDocument();
    });
  });

  it("clicking Connect repository opens the connect modal", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("sc-btn-connect")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("sc-btn-connect"));
    await waitFor(() => {
      expect(screen.getByTestId("sc-connect-modal")).toBeInTheDocument();
    });
  });

  it("connect modal Save is disabled until repo URL is set", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("sc-btn-connect")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("sc-btn-connect"));
    await waitFor(() => {
      expect(screen.getByTestId("sc-modal-save")).toBeInTheDocument();
    });
    expect(screen.getByTestId("sc-modal-save")).toBeDisabled();
    fireEvent.change(screen.getByTestId("sc-modal-repo-url"), {
      target: { value: "https://github.com/org/repo.git" },
    });
    expect(screen.getByTestId("sc-modal-save")).not.toBeDisabled();
  });

  it("Test connection shows success when API returns ok:true", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/test")) {
        return Promise.resolve({
          status: 200,
          ok: true,
          json: async () => ({ ok: true, message: "" }),
        });
      }
      return Promise.resolve({
        status: 404,
        ok: false,
        json: async () => ({}),
      });
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("sc-btn-connect")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("sc-btn-connect"));
    await waitFor(() => {
      expect(screen.getByTestId("sc-modal-repo-url")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId("sc-modal-repo-url"), {
      target: { value: "https://github.com/org/repo.git" },
    });
    fireEvent.click(screen.getByTestId("sc-test-connection"));
    await waitFor(() => {
      expect(screen.getByTestId("sc-test-result")).toHaveTextContent(
        "app.settings.sourceControl.connectModal.testOk",
      );
    });
  });

  it("Test connection shows failure when API returns error", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/test")) {
        return Promise.resolve({
          status: 400,
          ok: false,
          json: async () => ({ error: "bad credentials" }),
        });
      }
      return Promise.resolve({
        status: 404,
        ok: false,
        json: async () => ({}),
      });
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("sc-btn-connect")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("sc-btn-connect"));
    await waitFor(() => {
      expect(screen.getByTestId("sc-modal-repo-url")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId("sc-modal-repo-url"), {
      target: { value: "https://github.com/org/repo.git" },
    });
    fireEvent.click(screen.getByTestId("sc-test-connection"));
    await waitFor(() => {
      expect(screen.getByTestId("sc-test-result")).toHaveTextContent(
        "app.settings.sourceControl.connectModal.testFail",
      );
    });
  });

  it("shows connected panel when status API returns connected:true", async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        connected: true,
        branch: "main",
        ahead: 0,
        behind: 0,
        pendingChanges: [],
        repoUrl: "https://github.com/org/repo.git",
        lastSyncAt: "2026-01-01T00:00:00Z",
      }),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("sc-connected-panel")).toBeInTheDocument();
    });
    expect(screen.getByTestId("sc-status-badge")).toHaveTextContent(
      "app.settings.sourceControl.statusConnected",
    );
    expect(screen.getByTestId("sc-repo-url")).toHaveTextContent(
      "https://github.com/org/repo.git",
    );
  });

  it("connected panel shows disconnect button which opens alert dialog", async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        connected: true,
        branch: "main",
        ahead: 0,
        behind: 0,
        pendingChanges: [],
        repoUrl: "https://github.com/org/repo.git",
        lastSyncAt: null,
      }),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("sc-btn-disconnect")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("sc-btn-disconnect"));
    await waitFor(() => {
      expect(
        screen.getByText("app.settings.sourceControl.disconnectConfirm"),
      ).toBeInTheDocument();
    });
  });

  it("adds and removes a protected branch", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("sc-protected-input")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId("sc-protected-input"), {
      target: { value: "release" },
    });
    fireEvent.click(screen.getByTestId("sc-protected-add"));
    await waitFor(() => {
      expect(screen.getByTestId("sc-protected-remove-release")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("sc-protected-remove-release"));
    await waitFor(() => {
      expect(screen.queryByTestId("sc-protected-remove-release")).toBeNull();
    });
  });

  it("auto-sync toggle reveals interval input", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("sc-auto-sync")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("sc-auto-sync-interval")).toBeNull();
    fireEvent.click(screen.getByTestId("sc-auto-sync"));
    await waitFor(() => {
      expect(screen.getByTestId("sc-auto-sync-interval")).toBeInTheDocument();
    });
  });
});
