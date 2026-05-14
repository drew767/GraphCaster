// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SignupView from "./Signup";

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

function renderSignup() {
  return render(
    <MemoryRouter>
      <SignupView />
    </MemoryRouter>
  );
}

describe("SignupView", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    vi.restoreAllMocks();
  });

  it("renders all form fields", () => {
    renderSignup();
    expect(screen.getByTestId("signup-first-name")).toBeInTheDocument();
    expect(screen.getByTestId("signup-last-name")).toBeInTheDocument();
    expect(screen.getByTestId("signup-email")).toBeInTheDocument();
    expect(screen.getByTestId("signup-password")).toBeInTheDocument();
    expect(screen.getByTestId("signup-submit")).toBeInTheDocument();
  });

  it("renders sign-in link", () => {
    renderSignup();
    expect(screen.getByTestId("signin-link")).toBeInTheDocument();
  });

  it("shows error message on failed signup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Email already in use." }), { status: 409 })
      )
    );
    renderSignup();

    fireEvent.change(screen.getByTestId("signup-first-name"), { target: { value: "Jane" } });
    fireEvent.change(screen.getByTestId("signup-last-name"), { target: { value: "Doe" } });
    fireEvent.change(screen.getByTestId("signup-email"), { target: { value: "jane@example.com" } });
    fireEvent.change(screen.getByTestId("signup-password"), { target: { value: "pass" } });
    fireEvent.click(screen.getByTestId("signup-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("signup-error")).toBeInTheDocument();
    });
  });

  it("navigates to /home/workflows on successful signup", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    renderSignup();

    fireEvent.change(screen.getByTestId("signup-first-name"), { target: { value: "Jane" } });
    fireEvent.change(screen.getByTestId("signup-last-name"), { target: { value: "Doe" } });
    fireEvent.change(screen.getByTestId("signup-email"), { target: { value: "jane@example.com" } });
    fireEvent.change(screen.getByTestId("signup-password"), { target: { value: "pass" } });
    fireEvent.click(screen.getByTestId("signup-submit"));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/home/workflows", { replace: true });
    });
  });
});
