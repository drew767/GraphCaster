// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockSetTheme = vi.fn();
let mockTheme = "auto";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (opts) {
        return Object.entries(opts).reduce<string>(
          (s, [k2, v]) => s.replace(`{{${k2}}}`, String(v)),
          k,
        );
      }
      return k;
    },
    i18n: { changeLanguage: vi.fn(), language: "en" },
  }),
}));

vi.mock("../../stores/themeStore", () => ({
  useThemeStore: () => ({
    theme: mockTheme,
    setTheme: mockSetTheme,
    effective: () => "light",
  }),
}));

const { changeLanguageMock } = vi.hoisted(() => ({
  changeLanguageMock: vi.fn(),
}));
vi.mock("../../i18n", () => ({
  default: { language: "en", changeLanguage: changeLanguageMock },
}));

const toastMock = {
  show: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
  dismissAll: vi.fn(),
};
vi.mock("../../toast/ToastProvider", () => ({
  useToast: () => ({ toast: toastMock, push: vi.fn() }),
}));

vi.mock("../../components/ui", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../components/ui");
  function MockSelect(props: {
    value?: string;
    onValueChange?: (v: string) => void;
    options: Array<{ value: string; label: string }>;
    "data-testid"?: string;
    id?: string;
    "aria-label"?: string;
  }) {
    return (
      <select
        id={props.id}
        aria-label={props["aria-label"]}
        data-testid={props["data-testid"]}
        value={props.value}
        onChange={(e) => props.onValueChange?.(e.target.value)}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return { ...actual, Select: MockSelect };
});

import PersonalPage from "./Personal";

function renderPage() {
  return render(
    <MemoryRouter>
      <PersonalPage />
    </MemoryRouter>,
  );
}

describe("Personal settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTheme = "auto";
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    if (!document.getElementById("radix-portal-root")) {
      const el = document.createElement("div");
      el.id = "radix-portal-root";
      document.body.appendChild(el);
    }
  });

  it("renders all four sections", () => {
    renderPage();
    expect(screen.getByTestId("section-profile")).toBeInTheDocument();
    expect(screen.getByTestId("section-password")).toBeInTheDocument();
    expect(screen.getByTestId("section-mfa")).toBeInTheDocument();
    expect(screen.getByTestId("section-personalization")).toBeInTheDocument();
  });

  it("save profile button is visible", () => {
    renderPage();
    expect(screen.getByTestId("btn-save-profile")).toBeInTheDocument();
  });

  it("password change shows error when passwords do not match", () => {
    renderPage();
    fireEvent.change(screen.getByTestId("input-new-password"), { target: { value: "abcdefgh" } });
    fireEvent.change(screen.getByTestId("input-confirm-password"), { target: { value: "xyz12345" } });
    fireEvent.click(screen.getByTestId("btn-update-password"));
    expect(screen.getByTestId("password-error")).toBeInTheDocument();
  });

  it("password change rejects short new password", () => {
    renderPage();
    fireEvent.change(screen.getByTestId("input-new-password"), { target: { value: "abc" } });
    fireEvent.change(screen.getByTestId("input-confirm-password"), { target: { value: "abc" } });
    fireEvent.click(screen.getByTestId("btn-update-password"));
    expect(screen.getByTestId("password-error")).toBeInTheDocument();
  });

  it("MFA QR placeholder is hidden when disabled", () => {
    renderPage();
    expect(screen.queryByTestId("mfa-qr-placeholder")).toBeNull();
    expect(screen.getByTestId("btn-enable-mfa")).toBeInTheDocument();
  });

  it("theme RadioGroup is rendered", () => {
    renderPage();
    expect(screen.getByTestId("theme-radio")).toBeInTheDocument();
  });

  it("language Select is rendered", () => {
    renderPage();
    expect(screen.getByTestId("language-select")).toBeInTheDocument();
  });

  it("language change persists to localStorage and calls i18n.changeLanguage", async () => {
    renderPage();
    const select = screen.getByTestId("language-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "ru" } });

    await waitFor(() => {
      expect(changeLanguageMock).toHaveBeenCalledWith("ru");
    });
    expect(localStorage.getItem("gc.locale")).toBe("ru");
  });

  it("avatar URL input is present", () => {
    renderPage();
    expect(screen.getByTestId("input-avatar-url")).toBeInTheDocument();
  });

  it("invalid avatar URL on save shows error", () => {
    renderPage();
    fireEvent.change(screen.getByTestId("input-avatar-url"), { target: { value: "not-a-url" } });
    fireEvent.click(screen.getByTestId("btn-save-profile"));
    expect(screen.getByTestId("avatar-url-error")).toBeInTheDocument();
  });
});
