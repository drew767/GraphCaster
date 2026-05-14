// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { InviteUsersModal, INVITE_USERS_MODAL_KEY } from "./InviteUsersModal";

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

let _open = true;
const closeModalMock = vi.fn();

vi.mock("../../app/stores/uiStore", () => ({
  useUIStore: (sel: (s: unknown) => unknown) => {
    const store = {
      modals: {},
      openModal: vi.fn(),
      closeModal: closeModalMock,
      isModalOpen: (_key: string) => _open,
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
  _open = true;
  if (!document.getElementById("radix-portal-root")) {
    const el = document.createElement("div");
    el.id = "radix-portal-root";
    document.body.appendChild(el);
  }
  // clipboard mock
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InviteUsersModal", () => {
  it("renders the invite form when open", () => {
    render(<InviteUsersModal />);
    expect(screen.getByTestId("invite-form")).toBeDefined();
    expect(screen.getByTestId("invite-emails-input")).toBeDefined();
    expect(screen.getByTestId("invite-role-group")).toBeDefined();
  });

  it("does not render when closed", () => {
    _open = false;
    render(<InviteUsersModal />);
    expect(screen.queryByTestId("invite-form")).toBeNull();
  });

  it("shows validation error when sending with empty email field", async () => {
    render(<InviteUsersModal />);
    fireEvent.click(screen.getByTestId("invite-send-btn"));
    await waitFor(() => {
      expect(screen.getByText("app.settings.users.invite.emailRequired")).toBeDefined();
    });
  });

  it("sends invites and shows results on success", async () => {
    const results = [
      { email: "alice@example.com", inviteLink: "https://gc.io/invite/abc" },
    ];
    mockFetch(results);
    render(<InviteUsersModal />);
    fireEvent.change(screen.getByTestId("invite-emails-input"), {
      target: { value: "alice@example.com" },
    });
    fireEvent.click(screen.getByTestId("invite-send-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("invite-results")).toBeDefined();
    });
    expect(screen.getByText("alice@example.com")).toBeDefined();
  });

  it("shows error toast when API returns 500", async () => {
    mockFetch({}, 500);
    render(<InviteUsersModal />);
    fireEvent.change(screen.getByTestId("invite-emails-input"), {
      target: { value: "alice@example.com" },
    });
    fireEvent.click(screen.getByTestId("invite-send-btn"));
    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
  });
});
