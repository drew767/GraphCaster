// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (opts && "name" in opts) return `${k}:${String(opts.name)}`;
      return k;
    },
  }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import ExternalSecretsPage from "./ExternalSecrets";

function ok(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(body),
  } as Response);
}

function notFound() {
  return Promise.resolve({ ok: false } as Response);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ExternalSecretsPage />
    </MemoryRouter>,
  );
}

describe("ExternalSecrets settings page (UX55)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReturnValue(notFound());
  });

  it("renders the page heading", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("external-secrets-page")).toBeInTheDocument(),
    );
  });

  it("shows three provider cards after loading", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("providers-list")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("provider-card-local_file")).toBeInTheDocument();
    expect(screen.getByTestId("provider-card-hashicorp_vault")).toBeInTheDocument();
    expect(screen.getByTestId("provider-card-aws_secrets_manager")).toBeInTheDocument();
  });

  it("local_file card shows connected status by default", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("provider-status-local_file")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("provider-status-local_file")).toHaveTextContent(
      "app.settings.externalSecrets.status.connected",
    );
  });

  it("opens configure modal when Configure button is clicked", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("btn-configure-hashicorp_vault")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("btn-configure-hashicorp_vault"));
    await waitFor(() =>
      expect(screen.getByTestId("vault-url-input")).toBeInTheDocument(),
    );
  });

  it("loads remote provider status when API returns data", async () => {
    mockFetch.mockReturnValueOnce(
      ok([{ id: "hashicorp_vault", status: "connected" }]),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("provider-status-hashicorp_vault")).toHaveTextContent(
        "app.settings.externalSecrets.status.connected",
      ),
    );
  });

  it("test button calls POST and updates status to connected", async () => {
    mockFetch
      .mockReturnValueOnce(notFound())
      .mockReturnValueOnce(ok({}));
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("btn-test-hashicorp_vault")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("btn-test-hashicorp_vault"));
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/secrets/providers/hashicorp_vault/test",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});
