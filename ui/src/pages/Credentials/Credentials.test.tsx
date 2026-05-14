// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import CredentialsView, { CREDENTIALS_FILTER_TYPE_STORAGE_KEY } from "./Credentials";

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

// Mock uiStore
const openModalMock = vi.fn();
vi.mock("../../app/stores/uiStore", () => ({
  useUIStore: (sel: (s: unknown) => unknown) => {
    const store = {
      modals: {},
      openModal: openModalMock,
      closeModal: vi.fn(),
      isModalOpen: () => false,
      getModalPayload: () => undefined,
    };
    return sel(store);
  },
}));

// Toast mock
const toastWarningMock = vi.fn();
const toastErrorMock = vi.fn();
const toastInfoMock = vi.fn();
vi.mock("../../toast/ToastProvider", () => ({
  useToast: () => ({
    toast: {
      show: vi.fn(),
      warning: toastWarningMock,
      error: toastErrorMock,
      success: vi.fn(),
      info: toastInfoMock,
      dismiss: vi.fn(),
      dismissAll: vi.fn(),
    },
    push: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCred(overrides: Partial<{
  id: string; name: string; type: string; provider: string;
  status: string; usedByWorkflowCount: number; updatedAt: string; ownerName: string;
}> = {}) {
  return {
    id: "cred-1",
    name: "My OpenAI Key",
    type: "openai",
    provider: "env",
    status: "ready",
    usedByWorkflowCount: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CredentialsView", () => {
  it("renders page title", async () => {
    mockFetch([]);
    render(<CredentialsView />);
    await waitFor(() => expect(screen.queryByTestId("credentials-loading")).not.toBeInTheDocument());
    expect(screen.getByText("app.credentials.pageTitle")).toBeInTheDocument();
  });

  it("shows empty state when API returns empty array", async () => {
    mockFetch([]);
    render(<CredentialsView />);
    await waitFor(() => expect(screen.queryByTestId("credentials-loading")).not.toBeInTheDocument());
    // EmptyState renders data-testid="empty-state" on its root div
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByText("app.empty.credentials.title")).toBeInTheDocument();
  });

  it("renders credential cards when API returns data", async () => {
    mockFetch([makeCred({ name: "My OpenAI Key" }), makeCred({ id: "cred-2", name: "Anthropic Prod" })]);
    render(<CredentialsView />);
    await waitFor(() => expect(screen.getAllByTestId("credential-card")).toHaveLength(2));
    expect(screen.getByText("My OpenAI Key")).toBeInTheDocument();
    expect(screen.getByText("Anthropic Prod")).toBeInTheDocument();
  });

  it("shows warning toast and empty state on 404 from API", async () => {
    mockFetch({}, 404);
    render(<CredentialsView />);
    await waitFor(() => expect(toastWarningMock).toHaveBeenCalledWith(
      "app.credentials.notConfiguredWarning",
      expect.objectContaining({ id: "cred-not-configured" }),
    ));
    // EmptyState renders data-testid="empty-state" on its root div
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("shows error toast on non-404 API failure", async () => {
    mockFetch({}, 500);
    render(<CredentialsView />);
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("app.credentials.loadError"));
  });

  it("opens credential-edit modal without id when New button clicked", async () => {
    mockFetch([]);
    render(<CredentialsView />);
    await waitFor(() => expect(screen.queryByTestId("credentials-loading")).not.toBeInTheDocument());
    const newBtn = screen.getByText("app.credentials.newButton");
    await act(async () => { fireEvent.click(newBtn); });
    expect(openModalMock).toHaveBeenCalledWith("credential-edit");
  });

  it("shows setup-needed filter toggle in toolbar", async () => {
    mockFetch([]);
    render(<CredentialsView />);
    await waitFor(() => expect(screen.queryByTestId("credentials-loading")).not.toBeInTheDocument());
    expect(screen.getByText("app.credentials.filterSetupNeeded")).toBeInTheDocument();
  });

  it("renders usages pill with count for each card (UXP94)", async () => {
    mockFetch([makeCred({ id: "c1", usedByWorkflowCount: 3 })]);
    render(<CredentialsView />);
    await waitFor(() =>
      expect(screen.getByTestId("credential-usages-pill-c1")).toBeInTheDocument(),
    );
    expect(screen.getByText("credentials.usages.pillLabel_plural")).toBeInTheDocument();
  });

  it("renders usages pill with zero-state label when unused (UXP94)", async () => {
    mockFetch([makeCred({ id: "c-zero", usedByWorkflowCount: 0 })]);
    render(<CredentialsView />);
    await waitFor(() =>
      expect(screen.getByTestId("credential-usages-pill-c-zero")).toBeInTheDocument(),
    );
    expect(screen.getByText("credentials.usages.pillLabelZero")).toBeInTheDocument();
  });

  it("persists the type filter selection to localStorage (UXP96)", async () => {
    mockFetch([]);
    render(<CredentialsView />);
    await waitFor(() => expect(screen.queryByTestId("credentials-loading")).not.toBeInTheDocument());
    expect(localStorage.getItem(CREDENTIALS_FILTER_TYPE_STORAGE_KEY)).toBe("__all__");
  });

  it("reads the persisted type filter on mount (UXP96)", async () => {
    localStorage.setItem(CREDENTIALS_FILTER_TYPE_STORAGE_KEY, "openai");
    mockFetch([
      makeCred({ type: "openai", id: "c-o" }),
      makeCred({ type: "anthropic", id: "c-a" }),
    ]);
    render(<CredentialsView />);
    await waitFor(() => expect(screen.queryByTestId("credentials-loading")).not.toBeInTheDocument());
    await waitFor(() => {
      const cards = screen.queryAllByTestId("credential-card");
      expect(cards).toHaveLength(1);
    });
  });
});
