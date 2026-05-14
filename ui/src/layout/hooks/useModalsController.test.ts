// Copyright GraphCaster. All Rights Reserved.

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { useModalsController } from "./useModalsController";

describe("useModalsController", () => {
  it("starts with all modals closed", () => {
    const { result } = renderHook(() => useModalsController());

    expect(result.current.saveModalOpen).toBe(false);
    expect(result.current.appMessageModal).toBeNull();
    expect(result.current.nodeSearchOpen).toBe(false);
    expect(result.current.keyboardShortcutsOpen).toBe(false);
    expect(result.current.runHistoryOpen).toBe(false);
  });

  it("openSaveModal sets suggested name and opens modal", () => {
    const { result } = renderHook(() => useModalsController());

    act(() => {
      result.current.openSaveModal("my-graph.json");
    });

    expect(result.current.saveModalOpen).toBe(true);
    expect(result.current.saveModalSuggestedName).toBe("my-graph.json");
  });

  it("closeSaveModal closes the save modal", () => {
    const { result } = renderHook(() => useModalsController());
    act(() => {
      result.current.openSaveModal("x.json");
    });
    expect(result.current.saveModalOpen).toBe(true);

    act(() => {
      result.current.closeSaveModal();
    });
    expect(result.current.saveModalOpen).toBe(false);
  });

  it("openNodeSearch keeps nodeSearchOpenRef in sync", () => {
    const { result } = renderHook(() => useModalsController());

    act(() => {
      result.current.openNodeSearch();
    });
    expect(result.current.nodeSearchOpen).toBe(true);
    expect(result.current.nodeSearchOpenRef.current).toBe(true);

    act(() => {
      result.current.closeNodeSearch();
    });
    expect(result.current.nodeSearchOpen).toBe(false);
    expect(result.current.nodeSearchOpenRef.current).toBe(false);
  });

  it("openRunHistory and closeRunHistory toggle the modal", () => {
    const { result } = renderHook(() => useModalsController());
    act(() => {
      result.current.openRunHistory();
    });
    expect(result.current.runHistoryOpen).toBe(true);
    act(() => {
      result.current.closeRunHistory();
    });
    expect(result.current.runHistoryOpen).toBe(false);
  });

  it("Ctrl+K dispatches and opens node search", () => {
    const { result } = renderHook(() => useModalsController());

    act(() => {
      const ev = new KeyboardEvent("keydown", { key: "k", ctrlKey: true });
      window.dispatchEvent(ev);
    });

    expect(result.current.nodeSearchOpen).toBe(true);
  });

  it("F1 opens keyboard shortcuts modal", () => {
    const { result } = renderHook(() => useModalsController());

    act(() => {
      const ev = new KeyboardEvent("keydown", { key: "F1" });
      window.dispatchEvent(ev);
    });

    expect(result.current.keyboardShortcutsOpen).toBe(true);
  });
});
