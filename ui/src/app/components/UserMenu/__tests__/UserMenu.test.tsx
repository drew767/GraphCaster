// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { UserMenu } from "../UserMenu";

// Radix DropdownMenu uses PointerEvent internally — polyfill for jsdom
beforeAll(() => {
  if (typeof window !== "undefined" && !window.PointerEvent) {
    // @ts-expect-error jsdom polyfill
    window.PointerEvent = class PointerEvent extends MouseEvent {
      constructor(type: string, init?: PointerEventInit) {
        super(type, init);
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.HTMLElement.prototype as any).hasPointerCapture = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.HTMLElement.prototype as any).releasePointerCapture = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.HTMLElement.prototype as any).setPointerCapture = vi.fn();
  }
});

function openMenu() {
  const trigger = screen.getByTestId("user-pill");
  act(() => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
  });
}

function renderUserMenu(props: React.ComponentProps<typeof UserMenu> = {}) {
  return render(
    <MemoryRouter>
      <UserMenu {...props} />
    </MemoryRouter>
  );
}

describe("UserMenu", () => {
  it("renders avatar and user name in the pill trigger", () => {
    renderUserMenu({ user: { name: "Alice Smith", email: "alice@example.com" } });
    expect(screen.getByTestId("user-pill")).toBeInTheDocument();
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
  });

  it("uses default user when no user prop provided", () => {
    renderUserMenu();
    expect(screen.getByText("Local User")).toBeInTheDocument();
    expect(screen.getByText("local@graphcaster")).toBeInTheDocument();
  });

  it("opens dropdown on pill click", () => {
    renderUserMenu({ user: { name: "Bob", email: "bob@gc.io" } });
    openMenu();
    expect(screen.getByText("Personal settings")).toBeInTheDocument();
    expect(screen.getByText("API Keys")).toBeInTheDocument();
    expect(screen.getByText("Log out")).toBeInTheDocument();
  });

  it("calls onLogout when Log out is selected", () => {
    const onLogout = vi.fn();
    renderUserMenu({ onLogout });
    openMenu();
    act(() => { fireEvent.click(screen.getByText("Log out")); });
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("shows Theme submenu trigger", () => {
    renderUserMenu();
    openMenu();
    const themeItem = screen.getByText("Theme");
    expect(themeItem).toBeInTheDocument();
    const subtrigger = themeItem.closest(".gc-dropdown-subtrigger");
    expect(subtrigger).not.toBeNull();
  });

  it("collapsed mode hides name and email text", () => {
    renderUserMenu({
      user: { name: "Carol", email: "carol@gc.io" },
      collapsed: true,
    });
    expect(screen.queryByText("Carol")).not.toBeInTheDocument();
    expect(screen.queryByText("carol@gc.io")).not.toBeInTheDocument();
    expect(screen.getByTestId("user-pill")).toBeInTheDocument();
  });
});
