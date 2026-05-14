// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (opts) {
        return Object.entries(opts).reduce<string>(
          (s, [k2, v]) => s.replace(`{{${k2}}}`, String(v)),
          k,
        );
      }
      return k;
    },
  }),
}));

let mockIsOpen = true;
const mockCloseModal = vi.fn();

vi.mock("../../app/stores/uiStore", () => ({
  useUIStore: (selector: (s: unknown) => unknown) => {
    const store = {
      openModal: vi.fn(),
      isModalOpen: () => mockIsOpen,
      closeModal: mockCloseModal,
      modals: {},
    };
    return selector(store);
  },
}));

const mockOnCreate = vi.fn();

import { CreateApiKeyModal } from "./CreateApiKeyModal";

function renderModal() {
  return render(
    <MemoryRouter>
      <CreateApiKeyModal onCreate={mockOnCreate} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockIsOpen = true;
  mockCloseModal.mockClear();
  mockOnCreate.mockClear();
  if (!document.getElementById("radix-portal-root")) {
    const el = document.createElement("div");
    el.id = "radix-portal-root";
    document.body.appendChild(el);
  }
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("CreateApiKeyModal", () => {
  it("renders label input and scope list when open", () => {
    renderModal();
    expect(screen.getByTestId("modal-label-input")).toBeTruthy();
    expect(screen.getByTestId("scope-list")).toBeTruthy();
    expect(screen.getByTestId("scope-group-workflow")).toBeTruthy();
  });

  it("create button is disabled when label is empty", () => {
    renderModal();
    const btn = screen.getByTestId("modal-create-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("create button enables after entering label and selecting scope", () => {
    renderModal();
    fireEvent.change(screen.getByTestId("modal-label-input"), { target: { value: "CI Key" } });
    fireEvent.click(screen.getByTestId("scope-workflow:read"));
    const btn = screen.getByTestId("modal-create-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("group toggle selects all scopes in the group", () => {
    renderModal();
    const count = screen.getByTestId("scope-count");
    expect(count.textContent).toContain("0");
    fireEvent.click(screen.getByTestId("scope-group-toggle-workflow"));
    // workflow group has 2 scopes (workflow:read, workflow:write)
    expect(screen.getByTestId("scope-count").textContent).toContain("2");
  });

  it("selected count updates when individual scopes toggled", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("scope-credential:read"));
    expect(screen.getByTestId("scope-count").textContent).toContain("1");
    fireEvent.click(screen.getByTestId("scope-credential:write"));
    expect(screen.getByTestId("scope-count").textContent).toContain("2");
    fireEvent.click(screen.getByTestId("scope-credential:read"));
    expect(screen.getByTestId("scope-count").textContent).toContain("1");
  });

  it("calls onCreate with label and selected scopes on submit", async () => {
    mockOnCreate.mockResolvedValue({
      key: { id: "k1", label: "My Key", keyMasked: "••••", scopes: ["workflow:read"], lastUsedAt: null, createdAt: "" },
      rawKey: "raw-123",
    });
    renderModal();
    fireEvent.change(screen.getByTestId("modal-label-input"), { target: { value: "My Key" } });
    fireEvent.click(screen.getByTestId("scope-workflow:read"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-create-btn"));
    });
    await waitFor(() => expect(mockOnCreate).toHaveBeenCalled());
    const [callLabel, callScopes] = mockOnCreate.mock.calls[0]!;
    expect(callLabel).toBe("My Key");
    expect(callScopes).toContain("workflow:read");
  });

  it("after creation shows copy-once warning and copy button", async () => {
    mockOnCreate.mockResolvedValue({
      key: { id: "k2", label: "Key 2", keyMasked: "••••", scopes: ["admin"], lastUsedAt: null, createdAt: "" },
      rawKey: "raw-xyz-123",
    });
    renderModal();
    fireEvent.change(screen.getByTestId("modal-label-input"), { target: { value: "Key 2" } });
    fireEvent.click(screen.getByTestId("scope-admin"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-create-btn"));
    });
    await waitFor(() => expect(screen.getByTestId("modal-new-key")).toBeTruthy());
    expect(screen.getByTestId("copy-once-warning")).toBeTruthy();
    expect(screen.getByTestId("modal-copy-key-btn")).toBeTruthy();
    fireEvent.click(screen.getByTestId("modal-copy-key-btn"));
    await waitFor(() => {
      expect((navigator.clipboard.writeText as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        "raw-xyz-123",
      );
    });
  });

  it("closes modal when cancel is clicked", () => {
    renderModal();
    const cancel = screen.getByText("app.settings.apiKeys.modal.cancel");
    fireEvent.click(cancel);
    expect(mockCloseModal).toHaveBeenCalledWith("api-key-create");
  });
});
