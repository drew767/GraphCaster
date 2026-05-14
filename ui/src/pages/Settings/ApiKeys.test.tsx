// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const mockOpenModal = vi.fn();
const mockIsOpen = vi.fn(() => false);

vi.mock("../../app/stores/uiStore", () => ({
  useUIStore: (selector: (s: unknown) => unknown) => {
    const store = {
      openModal: mockOpenModal,
      isModalOpen: mockIsOpen,
      closeModal: vi.fn(),
      modals: {},
    };
    return selector(store);
  },
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

vi.mock("../../toast/ToastProvider", () => ({
  useToast: () => ({ toast: mockToast }),
}));

let mockKeys: import("../../hooks/useApiKeysData").ApiKey[] = [];
let mockLoading = false;
let mockError: string | null = null;
const mockCreateKey = vi.fn();
const mockRevokeKey = vi.fn();

vi.mock("../../hooks/useApiKeysData", () => ({
  useApiKeysData: () => ({
    keys: mockKeys,
    loading: mockLoading,
    error: mockError,
    createKey: mockCreateKey,
    revokeKey: mockRevokeKey,
    refresh: vi.fn(),
  }),
}));

vi.mock("./CreateApiKeyModal", () => ({
  CreateApiKeyModal: () => <div data-testid="create-api-key-modal" />,
  API_KEY_CREATE_MODAL: "api-key-create",
}));

import ApiKeysPage from "./ApiKeys";

function renderPage() {
  return render(
    <MemoryRouter>
      <ApiKeysPage />
    </MemoryRouter>,
  );
}

const SAMPLE_KEY: import("../../hooks/useApiKeysData").ApiKey = {
  id: "k1",
  label: "My CI key",
  keyMasked: "gc_••••••••••••abcd",
  scopes: ["run:execute", "graph:view"],
  lastUsedAt: null,
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  mockKeys = [];
  mockLoading = false;
  mockError = null;
  mockCreateKey.mockResolvedValue({ key: SAMPLE_KEY, rawKey: "raw-key" });
  mockRevokeKey.mockResolvedValue(undefined);
  vi.clearAllMocks();
});

describe("ApiKeys page (UX53)", () => {
  it("renders heading and create button", () => {
    renderPage();
    expect(screen.getByTestId("api-keys-page")).toBeTruthy();
    expect(screen.getByTestId("create-key-btn")).toBeTruthy();
  });

  it("shows empty state when no keys", () => {
    renderPage();
    expect(screen.getByTestId("api-keys-empty")).toBeTruthy();
  });

  it("renders key rows when keys are present", () => {
    mockKeys = [SAMPLE_KEY];
    renderPage();
    expect(screen.getByText("My CI key")).toBeTruthy();
    expect(screen.getByText("run:execute")).toBeTruthy();
  });

  it("opens create modal on create button click", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("create-key-btn"));
    expect(mockOpenModal).toHaveBeenCalledWith("api-key-create");
  });

  it("calls revokeKey and shows toast on revoke", async () => {
    mockKeys = [SAMPLE_KEY];
    renderPage();
    fireEvent.click(screen.getByTestId("revoke-key-k1"));
    await waitFor(() => expect(mockRevokeKey).toHaveBeenCalledWith("k1"));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  });

  it("shows error banner when load fails", () => {
    mockError = "HTTP 500";
    renderPage();
    expect(screen.getByTestId("api-keys-error")).toBeTruthy();
  });
});
