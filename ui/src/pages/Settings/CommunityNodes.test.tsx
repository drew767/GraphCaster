// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (opts && "name" in opts) return `${k}:${String(opts.name)}`;
      return k;
    },
  }),
}));

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

import CommunityNodesPage, { type InstalledPlugin, type RegistryPlugin } from "./CommunityNodes";

function makeOk(data: unknown) {
  return { ok: true, json: async () => data } as Response;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CommunityNodesPage />
    </MemoryRouter>,
  );
}

const samplePlugin: InstalledPlugin = {
  id: "plugin-1",
  name: "My Plugin",
  version: "1.2.3",
  author: "Author",
  enabled: true,
  permissions: { network: true, secrets: true },
};

const sampleRegistry: RegistryPlugin = {
  id: "reg-1",
  name: "Registry Plugin",
  version: "0.1.0",
  author: "Someone",
  description: "Does stuff",
  category: "ai",
  permissions: { modelCalls: true },
};

describe("CommunityNodes settings page (UX56)", () => {
  it("renders both Installed and Browse tabs", async () => {
    mockFetch.mockResolvedValue(makeOk([]));
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("community-nodes-page")).toBeInTheDocument(),
    );
    expect(screen.getByText("app.settings.communityNodes.tabInstalled")).toBeInTheDocument();
    expect(screen.getByText("app.settings.communityNodes.tabBrowse")).toBeInTheDocument();
  });

  it("Installed tab shows empty state when no plugins", async () => {
    mockFetch.mockResolvedValue(makeOk([]));
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("installed-empty")).toBeInTheDocument(),
    );
  });

  it("Installed tab renders plugin cards with enable/disable toggle", async () => {
    mockFetch.mockResolvedValueOnce(makeOk([samplePlugin]));
    mockFetch.mockResolvedValue(makeOk([]));
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("plugin-card-plugin-1")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("toggle-plugin-1")).toBeInTheDocument();
  });

  it("uninstall flow removes plugin card after confirmation", async () => {
    mockFetch.mockResolvedValueOnce(makeOk([samplePlugin]));
    mockFetch.mockResolvedValue(makeOk([]));
    renderPage();
    const uninstallBtn = await screen.findByTestId("btn-uninstall-plugin-1");
    fireEvent.click(uninstallBtn);
    const alertDialog = await screen.findByRole("alertdialog");
    const confirmBtn = within(alertDialog).getByRole("button", {
      name: "app.settings.communityNodes.uninstall",
    });
    fireEvent.click(confirmBtn);
    await waitFor(() =>
      expect(screen.queryByTestId("plugin-card-plugin-1")).not.toBeInTheDocument(),
    );
  });

  it("Browse tab shows registry results after switching tab", async () => {
    mockFetch.mockResolvedValue(makeOk([]));
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("installed-empty")).toBeInTheDocument(),
    );
    mockFetch.mockResolvedValueOnce(makeOk([sampleRegistry]));
    await act(async () => {
      fireEvent.mouseDown(
        screen.getByRole("tab", { name: "app.settings.communityNodes.tabBrowse" }),
        { button: 0, ctrlKey: false },
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId("registry-card-reg-1")).toBeInTheDocument(),
    );
  });

  it("install flow opens permission grant modal and calls install API", async () => {
    mockFetch.mockResolvedValue(makeOk([]));
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("installed-empty")).toBeInTheDocument(),
    );
    mockFetch.mockResolvedValueOnce(makeOk([sampleRegistry]));
    await act(async () => {
      fireEvent.mouseDown(
        screen.getByRole("tab", { name: "app.settings.communityNodes.tabBrowse" }),
        { button: 0, ctrlKey: false },
      );
    });
    const installBtn = await screen.findByTestId("btn-install-reg-1");
    fireEvent.click(installBtn);
    await waitFor(() =>
      expect(screen.getByTestId("grant-modal-body")).toBeInTheDocument(),
    );
    mockFetch.mockResolvedValueOnce(makeOk({}));
    fireEvent.click(screen.getByTestId("grant-accept-btn"));
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/plugins/registry/install",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("Browse tab shows empty state when registry returns no results", async () => {
    mockFetch.mockResolvedValue(makeOk([]));
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("installed-empty")).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.mouseDown(
        screen.getByRole("tab", { name: "app.settings.communityNodes.tabBrowse" }),
        { button: 0, ctrlKey: false },
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId("registry-empty")).toBeInTheDocument(),
    );
  });
});
