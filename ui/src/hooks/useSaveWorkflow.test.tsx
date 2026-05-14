// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useSaveWorkflow } from "./useSaveWorkflow";
import { useBannerStore } from "../app/stores/bannerStore";
import { useAutosaveStore } from "../app/stores/autosaveStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, d?: string) => d ?? k }),
}));

function okResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function busyResponse(): Response {
  return new Response("busy", { status: 503 });
}

beforeEach(() => {
  useBannerStore.getState().dismissAll();
  useAutosaveStore.setState({ byWorkflow: {}, retryHandlers: {} });
  vi.useFakeTimers();
});

describe("useSaveWorkflow — happy path", () => {
  it("posts once and sets lastSaved on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const { result } = renderHook(() => useSaveWorkflow({ fetchImpl }));

    await act(async () => {
      await result.current.save({ id: "wf-1" });
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.current.lastSaved).toBeTypeOf("number");
    expect(result.current.error).toBeNull();
  });
});

describe("useSaveWorkflow — retry on 503", () => {
  it("retries up to 3 attempts on 503 with backoff", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(busyResponse())
      .mockResolvedValueOnce(busyResponse())
      .mockResolvedValueOnce(okResponse());
    const { result } = renderHook(() => useSaveWorkflow({ fetchImpl }));

    const p = act(async () => {
      await result.current.save({ id: "wf-2" });
    });

    // Advance timers across both backoff waits (1s + 2s).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    await p;

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBeNull();
    expect(result.current.lastSaved).toBeTypeOf("number");
    // Retry banner was dismissed on success.
    expect(useBannerStore.getState().banners).toEqual([]);
  });

  it("shows a banner while retrying", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(busyResponse())
      .mockResolvedValueOnce(okResponse());
    const { result } = renderHook(() => useSaveWorkflow({ fetchImpl }));

    const p = act(async () => {
      await result.current.save({ id: "wf-3" });
    });
    // After the first 503, before the retry fires, banner is up.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(useBannerStore.getState().banners.length).toBe(1);
    expect(useBannerStore.getState().banners[0].id).toBe("gc.save.retrying");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    await p;
    expect(useBannerStore.getState().banners).toEqual([]);
  });
});

describe("useSaveWorkflow — non-503 failures don't retry", () => {
  it("records error on 500", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("boom", { status: 500 }));
    const { result } = renderHook(() => useSaveWorkflow({ fetchImpl }));
    await act(async () => {
      await result.current.save({ id: "wf-4" });
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.current.error).not.toBeNull();
  });
});
