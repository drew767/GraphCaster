// Copyright GraphCaster. All Rights Reserved.

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { useListNav } from "./useListNav";

function fakeKey(key: string): ReactKeyboardEvent {
  return {
    key,
    preventDefault: vi.fn(),
  } as unknown as ReactKeyboardEvent;
}

describe("useListNav", () => {
  it("starts at initialIndex (default 0)", () => {
    const { result } = renderHook(() => useListNav(["a", "b", "c"], vi.fn()));
    expect(result.current.focusedIndex).toBe(0);
  });

  it("respects custom initialIndex (clamped)", () => {
    const { result } = renderHook(() =>
      useListNav(["a", "b"], vi.fn(), { initialIndex: 5 }),
    );
    expect(result.current.focusedIndex).toBe(1);
  });

  it("ArrowDown advances focusedIndex", () => {
    const { result } = renderHook(() => useListNav(["a", "b", "c"], vi.fn()));
    act(() => result.current.handleKeyDown(fakeKey("ArrowDown")));
    expect(result.current.focusedIndex).toBe(1);
    act(() => result.current.handleKeyDown(fakeKey("ArrowDown")));
    expect(result.current.focusedIndex).toBe(2);
  });

  it("ArrowUp decreases focusedIndex (clamped at 0)", () => {
    const { result } = renderHook(() =>
      useListNav(["a", "b", "c"], vi.fn(), { initialIndex: 2 }),
    );
    act(() => result.current.handleKeyDown(fakeKey("ArrowUp")));
    expect(result.current.focusedIndex).toBe(1);
    act(() => result.current.handleKeyDown(fakeKey("ArrowUp")));
    act(() => result.current.handleKeyDown(fakeKey("ArrowUp")));
    expect(result.current.focusedIndex).toBe(0);
  });

  it("Home jumps to first, End jumps to last", () => {
    const { result } = renderHook(() =>
      useListNav(["a", "b", "c", "d"], vi.fn(), { initialIndex: 1 }),
    );
    act(() => result.current.handleKeyDown(fakeKey("End")));
    expect(result.current.focusedIndex).toBe(3);
    act(() => result.current.handleKeyDown(fakeKey("Home")));
    expect(result.current.focusedIndex).toBe(0);
  });

  it("Enter calls onActivate with item and index", () => {
    const onActivate = vi.fn();
    const { result } = renderHook(() =>
      useListNav(["a", "b", "c"], onActivate, { initialIndex: 1 }),
    );
    act(() => result.current.handleKeyDown(fakeKey("Enter")));
    expect(onActivate).toHaveBeenCalledWith("b", 1);
  });

  it("Space calls onSelect when provided", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useListNav(["a", "b"], vi.fn(), { initialIndex: 0, onSelect }),
    );
    act(() => result.current.handleKeyDown(fakeKey(" ")));
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it("wraps when wrap=true", () => {
    const { result } = renderHook(() =>
      useListNav(["a", "b", "c"], vi.fn(), { initialIndex: 2, wrap: true }),
    );
    act(() => result.current.handleKeyDown(fakeKey("ArrowDown")));
    expect(result.current.focusedIndex).toBe(0);
    act(() => result.current.handleKeyDown(fakeKey("ArrowUp")));
    expect(result.current.focusedIndex).toBe(2);
  });

  it("getItemProps gives tabIndex=0 only on focused item", () => {
    const { result } = renderHook(() =>
      useListNav(["a", "b", "c"], vi.fn(), { initialIndex: 1 }),
    );
    expect(result.current.getItemProps(0).tabIndex).toBe(-1);
    expect(result.current.getItemProps(1).tabIndex).toBe(0);
    expect(result.current.getItemProps(1)["aria-selected"]).toBe(true);
  });

  it("handles empty items gracefully", () => {
    const onActivate = vi.fn();
    const { result } = renderHook(() => useListNav<string>([], onActivate));
    act(() => result.current.handleKeyDown(fakeKey("ArrowDown")));
    expect(result.current.focusedIndex).toBe(0);
    expect(onActivate).not.toHaveBeenCalled();
  });
});
