// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NotFoundView from "./NotFound";

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

function renderNotFound() {
  return render(
    <MemoryRouter>
      <NotFoundView />
    </MemoryRouter>
  );
}

describe("NotFoundView", () => {
  it("renders 404 heading and title", () => {
    renderNotFound();
    expect(screen.getByText("app.errors.notFound.code")).toBeInTheDocument();
    expect(screen.getByText("app.errors.notFound.title")).toBeInTheDocument();
  });

  it("renders the reason text", () => {
    renderNotFound();
    expect(screen.getByText("app.errors.notFound.reason")).toBeInTheDocument();
  });

  it("go-home button navigates to /home/workflows", async () => {
    mockNavigate.mockClear();
    renderNotFound();
    fireEvent.click(screen.getByTestId("go-home-btn"));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/home/workflows");
    });
  });
});
