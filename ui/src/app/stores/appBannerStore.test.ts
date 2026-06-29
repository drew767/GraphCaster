// Copyright GraphCaster. All Rights Reserved.

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useAppBannerStore } from "./appBannerStore";

describe("appBannerStore", () => {
  afterEach(() => {
    act(() => {
      useAppBannerStore.getState().dismissAll();
    });
  });

  it("starts with empty banners", () => {
    const { result } = renderHook(() => useAppBannerStore());
    expect(result.current.banners).toEqual([]);
  });

  it("push adds a banner and returns its id", () => {
    const { result } = renderHook(() => useAppBannerStore());

    let returnedId: string;
    act(() => {
      returnedId = result.current.push({ type: "info", message: "Hello" });
    });

    expect(result.current.banners).toHaveLength(1);
    expect(result.current.banners[0].type).toBe("info");
    expect(result.current.banners[0].message).toBe("Hello");
    expect(result.current.banners[0].id).toBe(returnedId!);
  });

  it("dismiss removes the banner with matching id", () => {
    const { result } = renderHook(() => useAppBannerStore());

    let id1: string;
    let id2: string;
    act(() => {
      id1 = result.current.push({ type: "warning", message: "Warn" });
      id2 = result.current.push({ type: "error", message: "Error" });
    });

    act(() => {
      result.current.dismiss(id1!);
    });

    expect(result.current.banners).toHaveLength(1);
    expect(result.current.banners[0].id).toBe(id2!);
  });

  it("dismissAll clears all banners", () => {
    const { result } = renderHook(() => useAppBannerStore());

    act(() => {
      result.current.push({ type: "success", message: "A" });
      result.current.push({ type: "error", message: "B" });
    });
    expect(result.current.banners).toHaveLength(2);

    act(() => {
      result.current.dismissAll();
    });
    expect(result.current.banners).toHaveLength(0);
  });
});
