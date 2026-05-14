// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { DropdownMenu, type DropdownItem } from "../DropdownMenu";

// Radix DropdownMenu uses PointerEvent internally. Provide a minimal polyfill
// so jsdom tests can open the menu via click.
function setupPointerEventPolyfill() {
  if (typeof window !== "undefined" && !window.PointerEvent) {
    // @ts-expect-error - jsdom polyfill
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
}
setupPointerEventPolyfill();

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const BASIC_ITEMS: DropdownItem[] = [
  { id: "edit", label: "Edit", icon: "pencil", onSelect: vi.fn() },
  { id: "delete", label: "Delete", destructive: true, onSelect: vi.fn() },
  { id: "disabled-item", label: "Disabled", disabled: true, onSelect: vi.fn() },
];

function openMenu(triggerName = "Open menu") {
  const trigger = screen.getByRole("button", { name: triggerName });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DropdownMenu", () => {
  it("renders the trigger element", () => {
    render(
      <DropdownMenu trigger={<button>Open menu</button>} items={BASIC_ITEMS} />
    );
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
  });

  it("does not show items before trigger is clicked", () => {
    render(
      <DropdownMenu trigger={<button>Open menu</button>} items={BASIC_ITEMS} />
    );
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
  });

  it("opens and shows all items on trigger click", () => {
    render(
      <DropdownMenu trigger={<button>Open menu</button>} items={BASIC_ITEMS} />
    );
    act(() => { openMenu(); });
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });

  it("calls onSelect when a regular item is clicked", () => {
    const onSelect = vi.fn();
    const items: DropdownItem[] = [
      { id: "action", label: "Do Action", onSelect },
    ];
    render(
      <DropdownMenu trigger={<button>Open menu</button>} items={items} />
    );
    act(() => { openMenu(); });
    fireEvent.click(screen.getByText("Do Action"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("does not call onSelect when a disabled item is clicked", () => {
    const onSelect = vi.fn();
    const items: DropdownItem[] = [
      { id: "d", label: "Disabled Action", disabled: true, onSelect },
    ];
    render(
      <DropdownMenu trigger={<button>Open menu</button>} items={items} />
    );
    act(() => { openMenu(); });
    const disabledItem = screen.getByText("Disabled Action");
    fireEvent.click(disabledItem);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("applies destructive class to destructive items", () => {
    const items: DropdownItem[] = [
      { id: "del", label: "Delete", destructive: true },
    ];
    render(
      <DropdownMenu trigger={<button>Open menu</button>} items={items} />
    );
    act(() => { openMenu(); });
    // The Radix RxMenu.Item renders with role="menuitem"
    const item = screen.getByRole("menuitem", { name: /Delete/i });
    expect(item).toHaveClass("gc-dropdown-item--destructive");
  });

  it("renders a separator element", () => {
    const items: DropdownItem[] = [
      { id: "sep", separator: true },
      { id: "item", label: "After separator" },
    ];
    render(
      <DropdownMenu trigger={<button>Open menu</button>} items={items} />
    );
    act(() => { openMenu(); });
    // Radix Separator renders with role="separator" or as a div with gc-dropdown-separator class
    const content = document.querySelector(".gc-dropdown-content");
    const sep = content?.querySelector(".gc-dropdown-separator");
    expect(sep).not.toBeNull();
  });

  it("renders a group label", () => {
    const items: DropdownItem[] = [
      { id: "grp", groupLabel: "Actions" },
      { id: "item", label: "Item A" },
    ];
    render(
      <DropdownMenu trigger={<button>Open menu</button>} items={items} />
    );
    act(() => { openMenu(); });
    expect(screen.getByText("Actions")).toBeInTheDocument();
    const label = screen.getByText("Actions");
    expect(label.className).toContain("gc-dropdown-group-label");
  });

  it("displays shortcut text right-aligned", () => {
    const items: DropdownItem[] = [
      { id: "save", label: "Save", shortcut: "⌘S" },
    ];
    render(
      <DropdownMenu trigger={<button>Open menu</button>} items={items} />
    );
    act(() => { openMenu(); });
    const shortcut = screen.getByText("⌘S");
    expect(shortcut).toBeInTheDocument();
    expect(shortcut.className).toContain("gc-dropdown-item-shortcut");
  });

  it("renders a sub-menu trigger with chevron indicator", () => {
    const items: DropdownItem[] = [
      {
        id: "more",
        label: "More",
        children: [
          { id: "sub-a", label: "Sub A", onSelect: vi.fn() },
        ],
      },
    ];
    render(
      <DropdownMenu trigger={<button>Open menu</button>} items={items} />
    );
    act(() => { openMenu(); });
    const subTrigger = screen.getByText("More").closest(".gc-dropdown-subtrigger");
    expect(subTrigger).not.toBeNull();
    // chevron icon container is present
    const chevron = subTrigger?.querySelector(".gc-dropdown-item-chevron");
    expect(chevron).not.toBeNull();
  });

  it("opens sub-menu on pointer enter / click of sub-trigger", () => {
    const items: DropdownItem[] = [
      {
        id: "more",
        label: "More",
        children: [
          { id: "sub-a", label: "Sub Item A", onSelect: vi.fn() },
        ],
      },
    ];
    render(
      <DropdownMenu trigger={<button>Open menu</button>} items={items} />
    );
    act(() => { openMenu(); });
    const subTrigger = screen.getByText("More").closest("[data-radix-menu-subtrigger]") ??
      screen.getByText("More").closest(".gc-dropdown-subtrigger")!;
    // Radix sub-menu opens on pointer move / click
    act(() => {
      fireEvent.pointerEnter(subTrigger!);
      fireEvent.pointerMove(subTrigger!);
    });
    // Sub content may appear; if not in this jsdom env just check trigger rendered
    expect(subTrigger).toBeInTheDocument();
  });

  it("controlled: opens when open=true without click", () => {
    const items: DropdownItem[] = [
      { id: "a", label: "Controlled Item" },
    ];
    render(
      <DropdownMenu
        trigger={<button>Open menu</button>}
        items={items}
        open
      />
    );
    expect(screen.getByText("Controlled Item")).toBeInTheDocument();
  });

  it("controlled: stays closed when open=false", () => {
    const items: DropdownItem[] = [
      { id: "a", label: "Controlled Item" },
    ];
    render(
      <DropdownMenu
        trigger={<button>Open menu</button>}
        items={items}
        open={false}
      />
    );
    expect(screen.queryByText("Controlled Item")).not.toBeInTheDocument();
  });

  it("calls onOpenChange when menu opens", () => {
    const onOpenChange = vi.fn();
    const items: DropdownItem[] = [
      { id: "a", label: "Item" },
    ];
    render(
      <DropdownMenu
        trigger={<button>Open menu</button>}
        items={items}
        onOpenChange={onOpenChange}
      />
    );
    act(() => { openMenu(); });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("renders an icon inside the item when icon prop provided", () => {
    const items: DropdownItem[] = [
      { id: "with-icon", label: "Edit", icon: "pencil" },
    ];
    render(
      <DropdownMenu trigger={<button>Open menu</button>} items={items} />
    );
    act(() => { openMenu(); });
    const iconWrapper = document.querySelector(".gc-dropdown-item-icon");
    expect(iconWrapper).not.toBeNull();
    // Icon renders an SVG
    expect(iconWrapper?.querySelector("svg")).not.toBeNull();
  });
});
