// Copyright GraphCaster. All Rights Reserved.

import { render, screen, fireEvent, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import EnvironmentsPage from "./Environments";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === "object") {
        let s = key;
        for (const [k, v] of Object.entries(opts)) {
          s = s.replace(`{{${k}}}`, String(v));
        }
        return s;
      }
      return key;
    },
  }),
}));

describe("EnvironmentsPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the default Production and Development environments", () => {
    render(<EnvironmentsPage />);
    expect(screen.getByTestId("environment-card-prod")).toBeInTheDocument();
    expect(screen.getByTestId("environment-card-dev")).toBeInTheDocument();
    expect(screen.getByTestId("environment-active-prod")).toBeInTheDocument();
  });

  it("shows the info banner", () => {
    render(<EnvironmentsPage />);
    expect(screen.getByTestId("environments-banner")).toBeInTheDocument();
  });

  it("adds a new environment via the modal", () => {
    render(<EnvironmentsPage />);
    fireEvent.click(screen.getByTestId("environments-new-btn"));
    const nameInput = screen.getByTestId("environments-modal-name");
    fireEvent.change(nameInput, { target: { value: "Staging" } });
    fireEvent.click(screen.getByTestId("environments-modal-create"));
    expect(screen.getByTestId("environment-card-staging")).toBeInTheDocument();
  });

  it("disables the delete button for the production environment", () => {
    render(<EnvironmentsPage />);
    const deleteBtn = screen.getByTestId("environment-delete-prod") as HTMLButtonElement;
    expect(deleteBtn).toBeDisabled();
  });

  it("can delete a non-production environment", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<EnvironmentsPage />);
    expect(screen.getByTestId("environment-card-dev")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("environment-delete-dev"));
    expect(screen.queryByTestId("environment-card-dev")).not.toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("persists changes to localStorage", () => {
    const { unmount } = render(<EnvironmentsPage />);
    fireEvent.click(screen.getByTestId("environments-new-btn"));
    fireEvent.change(screen.getByTestId("environments-modal-name"), {
      target: { value: "QA" },
    });
    fireEvent.click(screen.getByTestId("environments-modal-create"));
    unmount();
    const stored = localStorage.getItem("gc.environments");
    expect(stored).not.toBeNull();
    expect(stored!).toContain("QA");
  });
});

// Suppress unused-import warning in some configurations.
void act;
