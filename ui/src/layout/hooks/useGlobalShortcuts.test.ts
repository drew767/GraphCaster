// Copyright GraphCaster. All Rights Reserved.

import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { useGlobalShortcuts } from "./useGlobalShortcuts";

function dispatchKey(init: KeyboardEventInit & { key: string }) {
  const ev = new KeyboardEvent("keydown", { cancelable: true, ...init });
  window.dispatchEvent(ev);
  return ev;
}

interface SetupOverrides {
  isBlocking?: () => boolean;
}

function setup(overrides: SetupOverrides = {}) {
  const onUndo = vi.fn();
  const onRedo = vi.fn();
  const onToggleNodePalette = vi.fn();
  const isBlocking = overrides.isBlocking ?? (() => false);
  const { unmount } = renderHook(() =>
    useGlobalShortcuts({
      isBlocking,
      onUndo,
      onRedo,
      onToggleNodePalette,
    }),
  );
  return { onUndo, onRedo, onToggleNodePalette, unmount };
}

describe("useGlobalShortcuts", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("Ctrl+Z triggers onUndo", () => {
    const { onUndo, onRedo } = setup();
    const ev = dispatchKey({ key: "z", ctrlKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(true);
  });

  it("Ctrl+Shift+Z triggers onRedo", () => {
    const { onUndo, onRedo } = setup();
    dispatchKey({ key: "z", ctrlKey: true, shiftKey: true });
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("Ctrl+Y triggers onRedo", () => {
    const { onRedo } = setup();
    dispatchKey({ key: "y", ctrlKey: true });
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Shift+N triggers onToggleNodePalette", () => {
    const { onToggleNodePalette } = setup();
    const ev = dispatchKey({ key: "n", ctrlKey: true, shiftKey: true });
    expect(onToggleNodePalette).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("Ctrl+Z is ignored when isBlocking() returns true", () => {
    const { onUndo, onRedo } = setup({ isBlocking: () => true });
    dispatchKey({ key: "z", ctrlKey: true });
    dispatchKey({ key: "y", ctrlKey: true });
    expect(onUndo).not.toHaveBeenCalled();
    expect(onRedo).not.toHaveBeenCalled();
  });

  it("Ctrl+Shift+N still fires even when isBlocking() is true (palette toggle is non-mutating)", () => {
    const { onToggleNodePalette } = setup({ isBlocking: () => true });
    dispatchKey({ key: "n", ctrlKey: true, shiftKey: true });
    expect(onToggleNodePalette).toHaveBeenCalledTimes(1);
  });

  it("ignores key events when target is a text input", () => {
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    input.focus();
    const { onUndo, onToggleNodePalette } = setup();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "n",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(onUndo).not.toHaveBeenCalled();
    expect(onToggleNodePalette).not.toHaveBeenCalled();
  });

  it("plain Z (no mod) does not trigger undo", () => {
    const { onUndo } = setup();
    dispatchKey({ key: "z" });
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("cleanup removes window listeners", () => {
    const { onUndo, unmount } = setup();
    unmount();
    dispatchKey({ key: "z", ctrlKey: true });
    expect(onUndo).not.toHaveBeenCalled();
  });
});
