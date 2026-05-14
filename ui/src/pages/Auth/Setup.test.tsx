// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import SetupView from "./Setup";

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

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

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

function renderSetup() {
  return render(
    <MemoryRouter>
      <SetupView />
    </MemoryRouter>,
  );
}

function fillValidStep1() {
  fireEvent.change(screen.getByTestId("setup-first-name"), { target: { value: "Jane" } });
  fireEvent.change(screen.getByTestId("setup-last-name"), { target: { value: "Doe" } });
  fireEvent.change(screen.getByTestId("setup-email"), { target: { value: "jane@example.com" } });
  fireEvent.change(screen.getByTestId("setup-password"), { target: { value: "supersecret" } });
  fireEvent.change(screen.getByTestId("setup-confirm-password"), { target: { value: "supersecret" } });
}

beforeEach(() => {
  navigateMock.mockClear();
  vi.restoreAllMocks();
});

describe("SetupView wizard", () => {
  it("renders step 1 by default and Next is disabled until valid", () => {
    renderSetup();
    expect(screen.getByTestId("setup-step-1")).toBeInTheDocument();
    const next = screen.getByTestId("setup-next") as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it("enables Next when step 1 fields are valid", () => {
    renderSetup();
    fillValidStep1();
    const next = screen.getByTestId("setup-next") as HTMLButtonElement;
    expect(next.disabled).toBe(false);
  });

  it("keeps Next disabled when password is too short", () => {
    renderSetup();
    fireEvent.change(screen.getByTestId("setup-first-name"), { target: { value: "Jane" } });
    fireEvent.change(screen.getByTestId("setup-last-name"), { target: { value: "Doe" } });
    fireEvent.change(screen.getByTestId("setup-email"), { target: { value: "jane@example.com" } });
    fireEvent.change(screen.getByTestId("setup-password"), { target: { value: "short" } });
    fireEvent.change(screen.getByTestId("setup-confirm-password"), { target: { value: "short" } });
    const next = screen.getByTestId("setup-next") as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it("keeps Next disabled when email is invalid", () => {
    renderSetup();
    fireEvent.change(screen.getByTestId("setup-first-name"), { target: { value: "Jane" } });
    fireEvent.change(screen.getByTestId("setup-last-name"), { target: { value: "Doe" } });
    fireEvent.change(screen.getByTestId("setup-email"), { target: { value: "not-an-email" } });
    fireEvent.change(screen.getByTestId("setup-password"), { target: { value: "supersecret" } });
    fireEvent.change(screen.getByTestId("setup-confirm-password"), { target: { value: "supersecret" } });
    const next = screen.getByTestId("setup-next") as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it("navigates step 1 → 2 → 3 and shows Finish on step 3", async () => {
    renderSetup();
    fillValidStep1();
    fireEvent.click(screen.getByTestId("setup-next"));
    await waitFor(() => expect(screen.getByTestId("setup-step-2")).toBeInTheDocument());
    expect(screen.getByTestId("setup-workspace-name")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("setup-next"));
    await waitFor(() => expect(screen.getByTestId("setup-step-3")).toBeInTheDocument());
    expect(screen.getByTestId("setup-finish")).toBeInTheDocument();
  });

  it("Back button returns to previous step", async () => {
    renderSetup();
    fillValidStep1();
    fireEvent.click(screen.getByTestId("setup-next"));
    await waitFor(() => expect(screen.getByTestId("setup-step-2")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("setup-back"));
    await waitFor(() => expect(screen.getByTestId("setup-step-1")).toBeInTheDocument());
  });

  it("Finish posts aggregated payload and navigates home", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSetup();
    fillValidStep1();
    fireEvent.click(screen.getByTestId("setup-next"));
    await waitFor(() => expect(screen.getByTestId("setup-step-2")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("setup-next"));
    await waitFor(() => expect(screen.getByTestId("setup-step-3")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId("setup-finish"));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/auth/setup");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.firstName).toBe("Jane");
    expect(body.lastName).toBe("Doe");
    expect(body.email).toBe("jane@example.com");
    expect(body.password).toBe("supersecret");
    expect(body.workspace?.name).toBeTruthy();
    expect(body.workspace?.slug).toBeTruthy();
    expect(body.preferences).toBeTruthy();
    expect(typeof body.preferences.telemetry).toBe("boolean");
    expect(body.preferences.locale).toBeTruthy();
    expect(body.preferences.theme).toBeTruthy();

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith("/", { replace: true }),
    );
  });

  it("step indicator is visible", () => {
    renderSetup();
    expect(screen.getByTestId("setup-step-indicator")).toBeInTheDocument();
  });
});
