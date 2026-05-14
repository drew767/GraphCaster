// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { CredentialEditModal, CREDENTIAL_EDIT_MODAL_KEY } from "./CredentialEditModal";

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

// Minimal uiStore: open=true, payload varies per test
let _open = true;
let _payload: { id?: string } | undefined = undefined;
const closeModalMock = vi.fn();

vi.mock("../../app/stores/uiStore", () => ({
  useUIStore: (sel: (s: unknown) => unknown) => {
    const store = {
      modals: {},
      openModal: vi.fn(),
      closeModal: closeModalMock,
      isModalOpen: (_key: string) => _open,
      getModalPayload: (_key: string) => _payload,
    };
    return sel(store);
  },
}));

// Toast mock
const toastWarningMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("../../toast/ToastProvider", () => ({
  useToast: () => ({
    toast: {
      show: vi.fn(),
      warning: toastWarningMock,
      error: toastErrorMock,
      success: toastSuccessMock,
      info: vi.fn(),
      dismiss: vi.fn(),
      dismissAll: vi.fn(),
    },
    push: vi.fn(),
  }),
}));

// Radix Dialog portals need this
beforeEach(() => {
  vi.clearAllMocks();
  _open = true;
  _payload = undefined;
  // ensure a portal target exists
  if (!document.getElementById("radix-portal-root")) {
    const el = document.createElement("div");
    el.id = "radix-portal-root";
    document.body.appendChild(el);
  }
});

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CredentialEditModal", () => {
  it("renders nothing when modal is closed", () => {
    _open = false;
    const { container } = render(<CredentialEditModal />);
    expect(container.firstChild).toBeNull();
  });

  it("renders type selection grid on new credential (no id in payload)", () => {
    _open = true;
    _payload = undefined;
    render(<CredentialEditModal />);
    expect(screen.getByTestId("credential-type-grid")).toBeInTheDocument();
    expect(screen.getByText("app.credentials.selectTypeTitle")).toBeInTheDocument();
  });

  it("transitions to form step after type selection click", async () => {
    _open = true;
    _payload = undefined;
    render(<CredentialEditModal />);
    const openaiBtn = screen.getByTestId("credential-type-openai");
    await act(async () => { fireEvent.click(openaiBtn); });
    expect(screen.getByTestId("credential-form")).toBeInTheDocument();
    expect(screen.queryByTestId("credential-type-grid")).not.toBeInTheDocument();
  });

  it("shows name validation error when saving with empty name", async () => {
    _open = true;
    _payload = undefined;
    render(<CredentialEditModal />);

    // Select a type first
    const openaiBtn = screen.getByTestId("credential-type-openai");
    await act(async () => { fireEvent.click(openaiBtn); });

    // Click Save without filling name
    const saveBtn = screen.getByText("app.credentials.saveButton");
    await act(async () => { fireEvent.click(saveBtn); });

    expect(screen.getByText("app.credentials.fieldNameRequired")).toBeInTheDocument();
  });

  it("calls POST /api/v1/credentials and shows success toast on valid save", async () => {
    mockFetch({}, 200);
    _open = true;
    _payload = undefined;
    render(<CredentialEditModal />);

    // Select type
    const openaiBtn = screen.getByTestId("credential-type-openai");
    await act(async () => { fireEvent.click(openaiBtn); });

    // Fill name
    const nameInput = screen.getByLabelText(/app.credentials.fieldName/i);
    await act(async () => { fireEvent.change(nameInput, { target: { value: "My Key" } }); });

    // Save
    const saveBtn = screen.getByText("app.credentials.saveButton");
    await act(async () => { fireEvent.click(saveBtn); });

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith("app.credentials.saveSuccess"));
    expect(closeModalMock).toHaveBeenCalledWith(CREDENTIAL_EDIT_MODAL_KEY);
  });

  it("shows warning toast and closes on 404 from save endpoint", async () => {
    mockFetch({}, 404);
    _open = true;
    _payload = undefined;
    render(<CredentialEditModal />);

    // Select type
    const openaiBtn = screen.getByTestId("credential-type-openai");
    await act(async () => { fireEvent.click(openaiBtn); });

    // Fill name
    const nameInput = screen.getByLabelText(/app.credentials.fieldName/i);
    await act(async () => { fireEvent.change(nameInput, { target: { value: "My Key" } }); });

    const saveBtn = screen.getByText("app.credentials.saveButton");
    await act(async () => { fireEvent.click(saveBtn); });

    await waitFor(() => expect(toastWarningMock).toHaveBeenCalledWith("app.credentials.notConfiguredWarning"));
    expect(closeModalMock).toHaveBeenCalledWith(CREDENTIAL_EDIT_MODAL_KEY);
  });

  it("renders OAuth connect button for OAuth credential types (e.g. github)", async () => {
    _open = true;
    _payload = undefined;
    render(<CredentialEditModal />);

    const githubBtn = screen.getByTestId("credential-type-github");
    await act(async () => { fireEvent.click(githubBtn); });

    expect(
      screen.getByText("app.credentials.oauthButton".replace("{{provider}}", "GitHub")),
    ).toBeInTheDocument();
  });

  it("test connection button is disabled when no credentialId (new mode)", async () => {
    _open = true;
    _payload = undefined;
    render(<CredentialEditModal />);

    const openaiBtn = screen.getByTestId("credential-type-openai");
    await act(async () => { fireEvent.click(openaiBtn); });

    const testBtn = screen.getByText("app.credentials.testConnectionButton");
    expect(testBtn.closest("button")).toBeDisabled();
  });
});
