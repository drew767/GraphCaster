// Copyright GraphCaster. All Rights Reserved.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAwarenessThrottle } from "../awareness";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createAwarenessThrottle", () => {
  it("publishes cursor after ~33ms", () => {
    const publish = vi.fn();
    const t = createAwarenessThrottle(publish);
    t.onMouseMove(100, 200);
    expect(publish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(40);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ cursor: { x: 100, y: 200 } }));
    t.destroy();
  });

  it("coalesces rapid mouse moves", () => {
    const publish = vi.fn();
    const t = createAwarenessThrottle(publish);
    t.onMouseMove(1, 2);
    t.onMouseMove(3, 4);
    t.onMouseMove(5, 6);
    vi.advanceTimersByTime(40);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ cursor: { x: 5, y: 6 } }));
    t.destroy();
  });

  it("publishes selection change", () => {
    const publish = vi.fn();
    const t = createAwarenessThrottle(publish);
    t.onSelectionChange(["n1", "n2"]);
    vi.advanceTimersByTime(40);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ selection: ["n1", "n2"] }),
    );
    t.destroy();
  });

  it("batches cursor and selection together", () => {
    const publish = vi.fn();
    const t = createAwarenessThrottle(publish);
    t.onMouseMove(10, 20);
    t.onSelectionChange(["x"]);
    vi.advanceTimersByTime(40);
    expect(publish).toHaveBeenCalledTimes(1);
    const arg = publish.mock.calls[0][0];
    expect(arg).toMatchObject({ cursor: { x: 10, y: 20 }, selection: ["x"] });
    t.destroy();
  });

  it("destroy cancels pending flush", () => {
    const publish = vi.fn();
    const t = createAwarenessThrottle(publish);
    t.onMouseMove(1, 2);
    t.destroy();
    vi.advanceTimersByTime(100);
    expect(publish).not.toHaveBeenCalled();
  });
});
