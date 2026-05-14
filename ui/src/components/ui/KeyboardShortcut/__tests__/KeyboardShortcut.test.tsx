// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { KeyboardShortcut } from "../KeyboardShortcut";

describe("KeyboardShortcut", () => {
  it("renders plain keys from string", () => {
    render(<KeyboardShortcut keys="Ctrl+K" />);
    const container = document.querySelector(".gc-kbd")!;
    expect(container).not.toBeNull();
    const keys = container.querySelectorAll("kbd");
    expect(keys.length).toBe(2);
    expect(keys[0].textContent).toBe("Ctrl");
    expect(keys[1].textContent).toBe("K");
  });

  it("renders keys from array", () => {
    render(<KeyboardShortcut keys={["Ctrl", "Shift", "P"]} />);
    const keys = document.querySelectorAll("kbd");
    expect(keys.length).toBe(3);
    expect(keys[0].textContent).toBe("Ctrl");
    expect(keys[1].textContent).toBe("Shift");
    expect(keys[2].textContent).toBe("P");
  });

  it("maps keys to mac symbols when platform is Mac", async () => {
    const original = navigator.platform;
    Object.defineProperty(navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });
    const { unmount } = render(<KeyboardShortcut keys={["Ctrl", "K"]} />);
    await new Promise((r) => setTimeout(r, 0));
    const keys = document.querySelectorAll("kbd");
    expect(keys[0].textContent).toBe("⌃");
    unmount();
    Object.defineProperty(navigator, "platform", {
      value: original,
      configurable: true,
    });
  });

  it("applies outlined variant class", () => {
    render(<KeyboardShortcut keys="Ctrl+K" variant="outlined" />);
    const container = document.querySelector(".gc-kbd");
    expect(container?.classList.contains("gc-kbd--outlined")).toBe(true);
  });

  it("applies size class", () => {
    render(<KeyboardShortcut keys="Ctrl+K" size="medium" />);
    const container = document.querySelector(".gc-kbd");
    expect(container?.classList.contains("gc-kbd--medium")).toBe(true);
  });

  it("renders custom separator", () => {
    render(<KeyboardShortcut keys={["Ctrl", "K"]} separator="-" />);
    const sep = document.querySelector(".gc-kbd__sep");
    expect(sep?.textContent).toBe("-");
  });
});
