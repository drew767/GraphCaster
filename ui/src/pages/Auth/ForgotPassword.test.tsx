// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ForgotPasswordView from "./ForgotPassword";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual };
});

function renderForgotPassword() {
  return render(
    <MemoryRouter>
      <ForgotPasswordView />
    </MemoryRouter>
  );
}

describe("ForgotPasswordView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders email input and submit button", () => {
    renderForgotPassword();
    expect(screen.getByTestId("forgot-email")).toBeInTheDocument();
    expect(screen.getByTestId("forgot-submit")).toBeInTheDocument();
  });

  it("renders back-to-signin link", () => {
    renderForgotPassword();
    expect(screen.getByTestId("back-to-signin")).toBeInTheDocument();
  });

  it("shows success message after submission", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    renderForgotPassword();

    fireEvent.change(screen.getByTestId("forgot-email"), { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByTestId("forgot-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("forgot-success-msg")).toBeInTheDocument();
      expect(screen.getByText("app.auth.forgotPassword.successMessage")).toBeInTheDocument();
    });
  });
});
