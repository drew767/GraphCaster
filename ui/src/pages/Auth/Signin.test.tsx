// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SigninView from "./Signin";

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
  useTranslation: () => ({ t: (k: string) => k }),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// isTauriRuntime returns false by default in jsdom (no __TAURI_INTERNALS__).
vi.mock("../../run/tauriEnv", () => ({
  isTauriRuntime: () => false,
}));

function renderSignin() {
  return render(
    <MemoryRouter>
      <SigninView />
    </MemoryRouter>
  );
}

describe("SigninView", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    vi.restoreAllMocks();
  });

  it("renders email, password inputs and sign-in button", () => {
    renderSignin();
    expect(screen.getByTestId("signin-email")).toBeInTheDocument();
    expect(screen.getByTestId("signin-password")).toBeInTheDocument();
    expect(screen.getByTestId("signin-submit")).toBeInTheDocument();
  });

  it("renders SSO buttons row", () => {
    renderSignin();
    expect(screen.getByTestId("sso-row")).toBeInTheDocument();
    expect(screen.getByTestId("sso-google")).toBeInTheDocument();
    expect(screen.getByTestId("sso-github")).toBeInTheDocument();
    expect(screen.getByTestId("sso-microsoft")).toBeInTheDocument();
  });

  it("renders forgot-password link", () => {
    renderSignin();
    expect(screen.getByTestId("forgot-password-link")).toBeInTheDocument();
  });

  it("renders sign-up link", () => {
    renderSignin();
    expect(screen.getByTestId("signup-link")).toBeInTheDocument();
  });

  it("shows error message on failed login", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    renderSignin();

    fireEvent.change(screen.getByTestId("signin-email"), { target: { value: "bad@example.com" } });
    fireEvent.change(screen.getByTestId("signin-password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByTestId("signin-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("signin-error")).toBeInTheDocument();
    });
  });

  it("navigates to /home/workflows on successful login", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    renderSignin();

    fireEvent.change(screen.getByTestId("signin-email"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByTestId("signin-password"), { target: { value: "correct" } });
    fireEvent.click(screen.getByTestId("signin-submit"));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/home/workflows", { replace: true });
    });
  });
});
