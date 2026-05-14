// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, waitFor, fireEvent, act, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { WorkflowVersionsModal, VERSIONS_MODAL_KEY } from "./WorkflowVersionsModal";
import type { WorkflowVersion } from "./WorkflowVersionsModal";

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

// Mock Icon to a lightweight stub (avoids loading the full SVG registry)
vi.mock("../ui/Icon/Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
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
const toastInfoMock = vi.fn();

vi.mock("../../toast/ToastProvider", () => ({
  useToast: () => ({
    toast: {
      show: vi.fn(),
      success: toastSuccessMock,
      error: toastErrorMock,
      warning: toastWarningMock,
      info: toastInfoMock,
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const sampleVersions: WorkflowVersion[] = [
  { version: 3, author: "alice", date: "2026-05-12", message: "Added cron trigger" },
  { version: 2, author: "bob", date: "2026-05-10", message: "Fixed fork node" },
  { version: 1, author: "alice", date: "2026-05-01", message: "Initial publish" },
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

async function renderOpen() {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(<WorkflowVersionsModal />);
    await Promise.resolve();
  });
  return result!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkflowVersionsModal", () => {
  it("renders nothing when modal is closed", () => {
    _open = false;
    const { container } = render(<WorkflowVersionsModal />);
    expect(container.firstChild).toBeNull();
  });

  it("renders version list after loading", async () => {
    mockFetch(sampleVersions);
    await renderOpen();
    await waitFor(() =>
      expect(screen.getByTestId("versions-list")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("version-row-3")).toBeInTheDocument();
    expect(screen.getByTestId("version-row-2")).toBeInTheDocument();
    expect(screen.getByTestId("version-row-1")).toBeInTheDocument();
  });

  it("View action button is present for each version", async () => {
    mockFetch(sampleVersions);
    await renderOpen();
    await waitFor(() =>
      expect(screen.getByTestId("version-view-3")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("version-view-2")).toBeInTheDocument();
  });

  it("Restore action calls rollback API and shows success toast", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(sampleVersions),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    vi.stubGlobal("fetch", fetchMock);

    await renderOpen();
    await waitFor(() => expect(screen.getByTestId("version-restore-2")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId("version-restore-2"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith(
        "app.workflows.versioning.restoreSuccess",
      ),
    );
    expect(closeModalMock).toHaveBeenCalledWith(VERSIONS_MODAL_KEY);
  });

  it("Diff action invokes onOpenDiff callback when provided", async () => {
    mockFetch(sampleVersions);
    const onOpenDiff = vi.fn();

    await act(async () => {
      render(<WorkflowVersionsModal onOpenDiff={onOpenDiff} />);
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId("version-diff-2")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId("version-diff-2"));
    });

    expect(onOpenDiff).toHaveBeenCalledWith("graph-1", 3, 2);
  });

  it("shows warning toast and empty state on 404 from versions endpoint", async () => {
    mockFetch({}, 404);
    await renderOpen();

    await waitFor(() =>
      expect(toastWarningMock).toHaveBeenCalledWith(
        "app.workflows.versioning.versionsNotFound",
      ),
    );
    expect(screen.getByTestId("versions-empty")).toBeInTheDocument();
  });
});
