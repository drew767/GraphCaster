// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { PublishWorkflowModal, PUBLISH_WORKFLOW_MODAL_KEY } from "./PublishWorkflowModal";

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
let _payload: { graphId?: string } | undefined = { graphId: "graph-1" };
const closeModalMock = vi.fn();
const openModalMock = vi.fn();

vi.mock("../../app/stores/uiStore", () => ({
  useUIStore: (sel: (s: unknown) => unknown) => {
    const store = {
      modals: {},
      openModal: openModalMock,
      closeModal: closeModalMock,
      isModalOpen: (_key: string) => _open,
      getModalPayload: (_key: string) => _payload,
    };
    return sel(store);
  },
}));

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const toastWarningMock = vi.fn();

vi.mock("../../toast/ToastProvider", () => ({
  useToast: () => ({
    toast: {
      show: vi.fn(),
      success: toastSuccessMock,
      error: toastErrorMock,
      warning: toastWarningMock,
      info: vi.fn(),
      dismiss: vi.fn(),
      dismissAll: vi.fn(),
    },
    push: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  _open = true;
  _payload = { graphId: "graph-1" };
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

describe("PublishWorkflowModal", () => {
  it("renders nothing when modal is closed", () => {
    _open = false;
    const { container } = render(<PublishWorkflowModal />);
    expect(container.firstChild).toBeNull();
  });

  it("renders message textarea and author input when open", () => {
    render(<PublishWorkflowModal />);
    expect(screen.getByTestId("publish-message-input")).toBeInTheDocument();
    expect(screen.getByTestId("publish-author-input")).toBeInTheDocument();
  });

  it("calls POST /api/v1/graphs/{id}/publish and shows success toast on confirm", async () => {
    mockFetch({ version: 3 }, 200);
    render(<PublishWorkflowModal />);

    const msgInput = screen.getByTestId("publish-message-input");
    await act(async () => {
      fireEvent.change(msgInput, { target: { value: "Added cron trigger" } });
    });

    const authorInput = screen.getByTestId("publish-author-input");
    await act(async () => {
      fireEvent.change(authorInput, { target: { value: "alice" } });
    });

    const confirmBtn = screen.getByTestId("publish-confirm-btn");
    await act(async () => { fireEvent.click(confirmBtn); });

    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith(
        "app.workflows.versioning.publishSuccess",
      ),
    );
    expect(closeModalMock).toHaveBeenCalledWith(PUBLISH_WORKFLOW_MODAL_KEY);
  });

  it("shows warning toast and closes on 404 from publish endpoint", async () => {
    mockFetch({}, 404);
    render(<PublishWorkflowModal />);

    const confirmBtn = screen.getByTestId("publish-confirm-btn");
    await act(async () => { fireEvent.click(confirmBtn); });

    await waitFor(() =>
      expect(toastWarningMock).toHaveBeenCalledWith(
        "app.workflows.versioning.publishNotFound",
      ),
    );
    expect(closeModalMock).toHaveBeenCalledWith(PUBLISH_WORKFLOW_MODAL_KEY);
  });
});
