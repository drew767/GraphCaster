// Copyright GraphCaster. All Rights Reserved.

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useUIStore } from "./uiStore";

describe("uiStore", () => {
  afterEach(() => {
    act(() => {
      useUIStore.setState({ modals: {} });
    });
  });

  it("openModal sets the modal to open with payload", () => {
    const { result } = renderHook(() => useUIStore());

    act(() => {
      result.current.openModal("test-modal", { foo: "bar" });
    });

    expect(result.current.isModalOpen("test-modal")).toBe(true);
    expect(result.current.getModalPayload("test-modal")).toEqual({ foo: "bar" });
  });

  it("closeModal sets the modal to closed", () => {
    const { result } = renderHook(() => useUIStore());

    act(() => {
      result.current.openModal("my-modal");
    });
    expect(result.current.isModalOpen("my-modal")).toBe(true);

    act(() => {
      result.current.closeModal("my-modal");
    });
    expect(result.current.isModalOpen("my-modal")).toBe(false);
  });

  it("isModalOpen returns false for unknown keys", () => {
    const { result } = renderHook(() => useUIStore());
    expect(result.current.isModalOpen("nonexistent")).toBe(false);
  });

  it("getModalPayload returns undefined for unknown keys", () => {
    const { result } = renderHook(() => useUIStore());
    expect(result.current.getModalPayload("nonexistent")).toBeUndefined();
  });

  it("multiple modals can be managed independently", () => {
    const { result } = renderHook(() => useUIStore());

    act(() => {
      result.current.openModal("modal-a", 1);
      result.current.openModal("modal-b", 2);
    });

    expect(result.current.isModalOpen("modal-a")).toBe(true);
    expect(result.current.isModalOpen("modal-b")).toBe(true);

    act(() => {
      result.current.closeModal("modal-a");
    });

    expect(result.current.isModalOpen("modal-a")).toBe(false);
    expect(result.current.isModalOpen("modal-b")).toBe(true);
    expect(result.current.getModalPayload("modal-b")).toBe(2);
  });
});
