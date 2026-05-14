// Copyright GraphCaster. All Rights Reserved.

// matchMedia polyfill must run before any module that touches it on import (e.g., themeStore).
if (typeof window !== "undefined" && !window.matchMedia) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}

import React from "react";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { i18nReady } from "../../../../i18n";

// Translate "leaf" key tokens (e.g. "signOut") to user-visible strings so tests
// can assert on prose rather than on i18next paths. Falls back to the trailing
// segment of the key, which keeps the dropdown menu items uniquely findable.
const TRANSLATIONS: Record<string, string> = {
  "app.sidebar.user.signOut": "Sign out",
  "app.sidebar.user.account": "Account",
  "app.sidebar.user.theme.label": "Theme",
  "app.sidebar.user.theme.light": "Light",
  "app.sidebar.user.theme.system": "System",
  "app.sidebar.user.theme.dark": "Dark",
};

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        const base = TRANSLATIONS[key] ?? key;
        if (!opts) return base;
        return Object.entries(opts).reduce<string>(
          (s, [k, v]) => s.replace(`{{${k}}}`, String(v)),
          base,
        );
      },
      i18n: { language: "en", changeLanguage: () => Promise.resolve() },
    }),
  };
});

import { MainSidebar } from "../MainSidebar";
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
  clampSidebarWidth,
} from "../SidebarResizer";

// Radix DropdownMenu uses PointerEvent internally — polyfill for jsdom.
beforeAll(async () => {
  await i18nReady;
  if (typeof window !== "undefined" && !window.matchMedia) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    });
  }
  if (typeof window !== "undefined" && !window.PointerEvent) {
    // @ts-expect-error jsdom polyfill
    window.PointerEvent = class PointerEvent extends MouseEvent {
      constructor(type: string, init?: PointerEventInit) {
        super(type, init);
      }
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window.HTMLElement.prototype as any).hasPointerCapture = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window.HTMLElement.prototype as any).releasePointerCapture = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window.HTMLElement.prototype as any).setPointerCapture = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window.HTMLElement.prototype as any).scrollIntoView = vi.fn();
});

beforeEach(() => {
  localStorage.clear();
  // The sidebar tests manually append <aside id="gc-sidebar-slot"> to document.body
  // outside of React. @testing-library/react's auto-cleanup only unmounts React
  // trees, so without explicit removal these slots — and Radix's leftover
  // pointer-events / scroll-lock side-effects on <body> — bleed across tests
  // and prevent portaled dropdown menus from opening in later cases.
  cleanup();
  document.body
    .querySelectorAll("aside#gc-sidebar-slot, [data-radix-popper-content-wrapper], [data-radix-focus-guard]")
    .forEach((node) => node.remove());
  document.body.removeAttribute("data-scroll-locked");
  document.body.style.removeProperty("pointer-events");
});

function renderSidebar() {
  const slot = document.createElement("aside");
  slot.id = "gc-sidebar-slot";
  document.body.appendChild(slot);
  const utils = render(
    <MemoryRouter>
      <MainSidebar portalTarget={slot} />
    </MemoryRouter>,
  );
  return { slot, ...utils };
}

describe("MainSidebar — resizer (UXP61)", () => {
  it("clampSidebarWidth respects the [200, 500] range", () => {
    expect(clampSidebarWidth(50)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(1000)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarWidth(300)).toBe(300);
  });

  it("uses persisted width from localStorage on render", () => {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "320");
    const { slot } = renderSidebar();
    expect(slot.style.getPropertyValue("--gc-sidebar-width")).toBe("320px");
  });

  it("falls back to default width when nothing is persisted", () => {
    const { slot } = renderSidebar();
    expect(slot.style.getPropertyValue("--gc-sidebar-width")).toBe(`${SIDEBAR_DEFAULT_WIDTH}px`);
  });

  it("drag updates width and persists to localStorage", () => {
    const { slot } = renderSidebar();
    const resizer = screen.getByTestId("sidebar-resizer");

    act(() => {
      fireEvent.pointerDown(resizer, { clientX: 220 });
    });
    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 320 }));
    });
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup"));
    });

    expect(slot.style.getPropertyValue("--gc-sidebar-width")).toBe("320px");
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("320");
  });

  it("ArrowRight key increases width by 8px and persists", () => {
    const { slot } = renderSidebar();
    const resizer = screen.getByTestId("sidebar-resizer");
    act(() => {
      fireEvent.keyDown(resizer, { key: "ArrowRight" });
    });
    expect(slot.style.getPropertyValue("--gc-sidebar-width")).toBe(`${SIDEBAR_DEFAULT_WIDTH + 8}px`);
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe(String(SIDEBAR_DEFAULT_WIDTH + 8));
  });
});

describe("MainSidebar — workspace switcher (UXP62)", () => {
  it("renders the workspace switcher at the top", () => {
    renderSidebar();
    expect(screen.getByTestId("workspace-switcher")).toBeInTheDocument();
  });

  it("opens a dropdown when clicked", () => {
    localStorage.setItem(
      "gc.workspaces",
      JSON.stringify([
        { id: "personal", name: "Personal" },
        { id: "team", name: "Team" },
      ]),
    );
    renderSidebar();
    const trigger = screen.getByTestId("workspace-switcher");
    act(() => {
      fireEvent.pointerDown(trigger, { button: 0 });
      fireEvent.click(trigger);
    });
    expect(screen.getByText("Team")).toBeInTheDocument();
  });
});

describe("MainSidebar — settings accordion (UXP63)", () => {
  it("toggles sub-items via chevron button", () => {
    renderSidebar();
    expect(screen.queryByTestId("sidebar-settings-sublist")).not.toBeInTheDocument();
    const toggle = screen.getByTestId("sidebar-settings-toggle");
    act(() => {
      fireEvent.click(toggle);
    });
    expect(screen.getByTestId("sidebar-settings-sublist")).toBeInTheDocument();
    act(() => {
      fireEvent.click(toggle);
    });
    expect(screen.queryByTestId("sidebar-settings-sublist")).not.toBeInTheDocument();
  });

  it("Settings text link still navigates to /settings", () => {
    renderSidebar();
    const link = screen.getByTestId("sidebar-nav-settings") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/settings");
  });
});

describe("MainSidebar — user dropdown (UXP64)", () => {
  it("renders user trigger with default user from fallback", () => {
    renderSidebar();
    const trigger = screen.getByTestId("sidebar-user-trigger");
    expect(trigger).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("opens dropdown and shows Sign out option", async () => {
    renderSidebar();
    const trigger = screen.getByTestId("sidebar-user-trigger");
    act(() => {
      fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" } as PointerEventInit);
      fireEvent.click(trigger);
    });
    expect(await screen.findByText("Sign out")).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
  });
});

describe("MainSidebar — starred workflows (UXP65)", () => {
  it("renders empty-state when no starred workflows", () => {
    renderSidebar();
    expect(screen.getByTestId("sidebar-starred-empty")).toBeInTheDocument();
  });

  it("renders up to 8 entries and a show-all link for overflow", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ id: `wf${i}`, name: `Workflow ${i}` }));
    localStorage.setItem("gc.starred_workflows", JSON.stringify(entries));
    renderSidebar();
    expect(screen.getByTestId("sidebar-starred-item-wf0")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-starred-item-wf7")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-starred-item-wf8")).not.toBeInTheDocument();
    expect(screen.getByTestId("sidebar-starred-showall")).toBeInTheDocument();
  });
});
