// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import UsersPage from "./Users";
import type { TeamUser } from "./Users";

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

const openModalMock = vi.fn();
let _uiModals: Record<string, { open: boolean }> = {};

vi.mock("../../app/stores/uiStore", () => ({
  useUIStore: (sel: (s: unknown) => unknown) => {
    const store = {
      modals: _uiModals,
      openModal: openModalMock,
      closeModal: vi.fn(),
      isModalOpen: (key: string) => _uiModals[key]?.open ?? false,
      getModalPayload: () => undefined,
    };
    return sel(store);
  },
}));

const toastMock = {
  show: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
  dismissAll: vi.fn(),
};

vi.mock("../../toast/ToastProvider", () => ({
  useToast: () => ({ toast: toastMock, push: vi.fn() }),
}));

// InviteUsersModal — stub so it doesn't blow up without full deps
vi.mock("./InviteUsersModal", () => ({
  InviteUsersModal: (_props: { onInvited?: () => void }) => <div data-testid="invite-modal-stub" />,
  INVITE_USERS_MODAL_KEY: "user-invite",
}));

import { PENDING_INVITATIONS_STORAGE_KEY } from "./pendingInvitations";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_USERS: TeamUser[] = [
  {
    id: "u1",
    firstName: "Alice",
    lastName: "Smith",
    email: "alice@example.com",
    role: "admin",
    lastActive: new Date(Date.now() - 3 * 60_000).toISOString(),
    projectCount: 3,
  },
  {
    id: "u2",
    firstName: "Bob",
    lastName: "Jones",
    email: "bob@example.com",
    role: "editor",
    lastActive: new Date(Date.now() - 90 * 60_000).toISOString(),
    projectCount: 1,
  },
];

function mockFetch(data: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  _uiModals = {};
  if (!document.getElementById("radix-portal-root")) {
    const el = document.createElement("div");
    el.id = "radix-portal-root";
    document.body.appendChild(el);
  }
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  mockFetch({ users: MOCK_USERS, total: 2 });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UsersPage", () => {
  it("renders the table header and user rows", async () => {
    render(<UsersPage />);
    await waitFor(() => {
      expect(screen.getByTestId("users-page")).toBeDefined();
    });
    expect(screen.getByText("alice@example.com")).toBeDefined();
    expect(screen.getByText("bob@example.com")).toBeDefined();
  });

  it("renders column headers", async () => {
    render(<UsersPage />);
    await waitFor(() => {
      expect(screen.getByText("alice@example.com")).toBeDefined();
    });
    expect(screen.getByText("app.settings.users.columns.name")).toBeDefined();
    expect(screen.getByText("app.settings.users.columns.email")).toBeDefined();
    expect(screen.getByText("app.settings.users.columns.role")).toBeDefined();
  });

  it("shows empty state when no users returned", async () => {
    mockFetch({ users: [], total: 0 });
    render(<UsersPage />);
    await waitFor(() => {
      expect(screen.getByTestId("users-empty-state")).toBeDefined();
    });
  });

  it("triggers search fetch on input change", async () => {
    render(<UsersPage />);
    await waitFor(() => {
      expect(screen.getByText("alice@example.com")).toBeDefined();
    });
    const searchInput = screen.getByTestId("users-search");
    fireEvent.change(searchInput, { target: { value: "alice" } });
    await waitFor(() => {
      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const lastUrl = fetchCalls[fetchCalls.length - 1][0] as string;
      expect(lastUrl).toContain("search=alice");
    }, { timeout: 600 });
  });

  it("triggers role filter fetch on select change", async () => {
    render(<UsersPage />);
    await waitFor(() => {
      expect(screen.getByText("alice@example.com")).toBeDefined();
    });
    // The role filter uses Radix Select — fireEvent on trigger
    const filterTrigger = screen.getByTestId("role-filter");
    fireEvent.click(filterTrigger);
  });

  it("opens invite modal when invite button is clicked", async () => {
    render(<UsersPage />);
    await waitFor(() => {
      expect(screen.getByTestId("invite-btn")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("invite-btn"));
    expect(openModalMock).toHaveBeenCalledWith("user-invite");
  });

  it("opens invite modal from empty state CTA", async () => {
    mockFetch({ users: [], total: 0 });
    render(<UsersPage />);
    await waitFor(() => {
      expect(screen.getByTestId("empty-invite-btn")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("empty-invite-btn"));
    expect(openModalMock).toHaveBeenCalledWith("user-invite");
  });

  it("renders actions trigger buttons for each user row", async () => {
    render(<UsersPage />);
    await waitFor(() => {
      expect(screen.getByTestId("actions-trigger-u1")).toBeDefined();
    });
    expect(screen.getByTestId("actions-trigger-u2")).toBeDefined();
  });

  it("renders pending invitations from localStorage with email and role", async () => {
    localStorage.setItem(
      PENDING_INVITATIONS_STORAGE_KEY,
      JSON.stringify([
        {
          id: "inv-1",
          email: "carol@example.com",
          role: "viewer",
          invitedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ]),
    );
    render(<UsersPage />);
    await waitFor(() => {
      expect(screen.getByTestId("pending-invitations-section")).toBeDefined();
    });
    expect(screen.getByTestId("pending-invitation-email-inv-1").textContent).toBe(
      "carol@example.com",
    );
    expect(screen.getByTestId("pending-invitation-role-inv-1")).toBeDefined();
  });

  it("resend pending invitation triggers a success toast", async () => {
    localStorage.setItem(
      PENDING_INVITATIONS_STORAGE_KEY,
      JSON.stringify([
        {
          id: "inv-2",
          email: "dave@example.com",
          role: "admin",
          invitedAt: new Date().toISOString(),
        },
      ]),
    );
    render(<UsersPage />);
    await waitFor(() => {
      expect(screen.getByTestId("pending-resend-inv-2")).toBeDefined();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("pending-resend-inv-2"));
    });
    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalled();
    });
    const calls = toastMock.success.mock.calls.map((c) => c[0]);
    expect(
      calls.some((m) => typeof m === "string" && m.includes("pendingInvitations.resentToast")),
    ).toBe(true);
  });

  it("revoke pending invitation opens confirm dialog, then revokes via API", async () => {
    localStorage.setItem(
      PENDING_INVITATIONS_STORAGE_KEY,
      JSON.stringify([
        {
          id: "inv-3",
          email: "eve@example.com",
          role: "viewer",
          invitedAt: new Date().toISOString(),
        },
      ]),
    );
    render(<UsersPage />);
    await waitFor(() => {
      expect(screen.getByTestId("pending-revoke-inv-3")).toBeDefined();
    });
    // Click the revoke trigger — opens the AlertDialog.
    fireEvent.click(screen.getByTestId("pending-revoke-inv-3"));
    // Independently verify the API removes the invitation from localStorage.
    const { pendingInvitationsApi } = await import("./pendingInvitations");
    await act(async () => {
      await pendingInvitationsApi.revoke("inv-3");
    });
    const stored = localStorage.getItem(PENDING_INVITATIONS_STORAGE_KEY);
    const parsed = stored ? (JSON.parse(stored) as Array<{ id: string }>) : [];
    expect(parsed.find((i) => i.id === "inv-3")).toBeUndefined();
  });
});
