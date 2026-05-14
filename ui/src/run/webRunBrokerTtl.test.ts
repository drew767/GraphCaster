// Copyright GraphCaster. All Rights Reserved.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_STREAM_LIFETIME_MS,
  _resetWebRunBrokerForTests,
  __peekLiveRunIdsForTest,
  __registerEventSourceForTest,
  __registerWebSocketForTest,
  sweepExpiredBrokerStreams,
} from "./webRunBroker";

describe("webRunBroker TTL cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetWebRunBrokerForTests();
  });

  afterEach(() => {
    _resetWebRunBrokerForTests();
    vi.useRealTimers();
  });

  it("closes EventSource entries older than MAX_STREAM_LIFETIME_MS", () => {
    const close = vi.fn();
    const fakeEs = { close } as unknown as EventSource;
    const start = Date.now();
    __registerEventSourceForTest("run-old", fakeEs, start - (MAX_STREAM_LIFETIME_MS + 1000));
    expect(__peekLiveRunIdsForTest()).toEqual(["run-old"]);

    const removed = sweepExpiredBrokerStreams();
    expect(removed).toContain("run-old");
    expect(close).toHaveBeenCalledTimes(1);
    expect(__peekLiveRunIdsForTest()).toEqual([]);
  });

  it("keeps WebSocket entries newer than the TTL and closes the expired one", () => {
    const closeOld = vi.fn();
    const closeFresh = vi.fn();
    const start = Date.now();
    __registerWebSocketForTest(
      "ws-old",
      { close: closeOld } as unknown as WebSocket,
      start - (MAX_STREAM_LIFETIME_MS + 5_000),
    );
    __registerWebSocketForTest(
      "ws-fresh",
      { close: closeFresh } as unknown as WebSocket,
      start,
    );

    sweepExpiredBrokerStreams();
    expect(closeOld).toHaveBeenCalledTimes(1);
    expect(closeFresh).not.toHaveBeenCalled();
    expect(__peekLiveRunIdsForTest()).toEqual(["ws-fresh"]);
  });

  it("scheduled sweep timer runs every minute and removes expired streams", () => {
    const close = vi.fn();
    const fakeEs = { close } as unknown as EventSource;
    const baseTime = 1_700_000_000_000;
    vi.setSystemTime(baseTime);
    __registerEventSourceForTest("run-1", fakeEs, baseTime);

    // Advance below TTL: sweep at 60s should not close.
    vi.setSystemTime(baseTime + 60_000);
    vi.advanceTimersByTime(60_000);
    expect(close).not.toHaveBeenCalled();
    expect(__peekLiveRunIdsForTest()).toEqual(["run-1"]);

    // Advance past TTL: next 60s tick should close.
    vi.setSystemTime(baseTime + MAX_STREAM_LIFETIME_MS + 60_000);
    vi.advanceTimersByTime(60_000);
    expect(close).toHaveBeenCalledTimes(1);
    expect(__peekLiveRunIdsForTest()).toEqual([]);
  });

  it("_resetWebRunBrokerForTests closes streams and clears the sweep timer", () => {
    const close = vi.fn();
    __registerEventSourceForTest(
      "run-1",
      { close } as unknown as EventSource,
      Date.now(),
    );
    _resetWebRunBrokerForTests();
    expect(close).toHaveBeenCalledTimes(1);
    // After reset, advancing timers must not trigger any sweep activity.
    vi.advanceTimersByTime(5 * 60_000);
    expect(__peekLiveRunIdsForTest()).toEqual([]);
  });
});
