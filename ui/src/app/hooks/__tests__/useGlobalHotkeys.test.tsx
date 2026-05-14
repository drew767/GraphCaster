// Copyright GraphCaster. All Rights Reserved.

import React, { useState } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useGlobalHotkeys } from "../useGlobalHotkeys";

function Harness({ onShow }: { onShow: () => void }) {
  useGlobalHotkeys({ onShowShortcuts: onShow });
  return <div data-testid="harness" />;
}

function ModalHarness() {
  const [open, setOpen] = useState(false);
  useGlobalHotkeys({ onShowShortcuts: () => setOpen(true) });
  return (
    <div>
      <span data-testid="status">{open ? "open" : "closed"}</span>
      <input data-testid="text-input" />
    </div>
  );
}

describe("useGlobalHotkeys", () => {
  it("invokes onShowShortcuts when ? is pressed outside of an input", () => {
    const onShow = vi.fn();
    render(<Harness onShow={onShow} />);
    act(() => {
      fireEvent.keyDown(document, { key: "?" });
    });
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it("ignores ? when a text input is focused", () => {
    render(<ModalHarness />);
    const input = screen.getByTestId("text-input") as HTMLInputElement;
    input.focus();
    act(() => {
      fireEvent.keyDown(input, { key: "?", bubbles: true });
    });
    expect(screen.getByTestId("status").textContent).toBe("closed");
  });

  it("ignores ? combined with modifier keys", () => {
    const onShow = vi.fn();
    render(<Harness onShow={onShow} />);
    act(() => {
      fireEvent.keyDown(document, { key: "?", ctrlKey: true });
    });
    act(() => {
      fireEvent.keyDown(document, { key: "?", metaKey: true });
    });
    expect(onShow).not.toHaveBeenCalled();
  });

  it("opens the modal harness when ? is pressed", () => {
    render(<ModalHarness />);
    expect(screen.getByTestId("status").textContent).toBe("closed");
    act(() => {
      fireEvent.keyDown(document, { key: "?" });
    });
    expect(screen.getByTestId("status").textContent).toBe("open");
  });
});
