// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { CredentialShareModal, type SharedUser } from "./CredentialShareModal";

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

const toastSuccess = vi.fn();
vi.mock("../../toast/ToastProvider", () => ({
  useToast: () => ({
    toast: {
      show: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      success: toastSuccess,
      info: vi.fn(),
      dismiss: vi.fn(),
      dismissAll: vi.fn(),
    },
    push: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("CredentialShareModal", () => {
  it("renders the empty state when no shares exist", async () => {
    render(
      <CredentialShareModal
        open
        credentialId="cred-1"
        credentialName="OpenAI"
        onClose={() => undefined}
        loadShares={async () => []}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("credential-share-empty")).toBeInTheDocument(),
    );
  });

  it("adds a user via Add button and shows success toast", async () => {
    const savedUsers: SharedUser[] = [];
    render(
      <CredentialShareModal
        open
        credentialId="cred-1"
        credentialName="OpenAI"
        onClose={() => undefined}
        loadShares={async () => []}
        saveShare={async (_id, user) => {
          savedUsers.push(user);
        }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("credential-share-empty")).toBeInTheDocument(),
    );

    const input = screen.getByTestId("credential-share-invite-input") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "jane@example.com" } });
    });
    const addBtn = screen.getByTestId("credential-share-add-btn");
    await act(async () => {
      fireEvent.click(addBtn);
    });

    await waitFor(() => expect(savedUsers).toHaveLength(1));
    expect(savedUsers[0].userId).toBe("jane@example.com");
    expect(toastSuccess).toHaveBeenCalledWith("credentials.share.addSuccess");
  });

  it("renders shared users and removes via X button", async () => {
    const initial: SharedUser[] = [
      { userId: "alice", name: "Alice", role: "viewer" },
    ];
    render(
      <CredentialShareModal
        open
        credentialId="cred-1"
        credentialName="OpenAI"
        onClose={() => undefined}
        loadShares={async () => initial}
        removeShare={async () => undefined}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("credential-share-user-alice")).toBeInTheDocument(),
    );
    const removeBtn = screen.getByTestId("credential-share-remove-alice");
    await act(async () => {
      fireEvent.click(removeBtn);
    });
    await waitFor(() =>
      expect(screen.queryByTestId("credential-share-user-alice")).not.toBeInTheDocument(),
    );
  });
});
