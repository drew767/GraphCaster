// Copyright GraphCaster. All Rights Reserved.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FPSCounter, PerformanceMonitor, RenderTracker } from "../../utils/performanceMonitor";

describe("FPSCounter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calculates FPS from frame times", () => {
    const counter = new FPSCounter();

    for (let i = 0; i < 60; i++) {
      counter.recordFrame(i * (1000 / 60));
    }

    const fps = counter.getFPS();
    expect(fps).toBeGreaterThan(55);
    expect(fps).toBeLessThan(65);
  });

  it("returns 0 with insufficient samples", () => {
    const counter = new FPSCounter();
    counter.recordFrame(0);
    expect(counter.getFPS()).toBe(0);
  });
});

describe("RenderTracker", () => {
  it("tracks component render count", () => {
    const tracker = new RenderTracker();

    tracker.recordRender("NodeComponent");
    tracker.recordRender("NodeComponent");
    tracker.recordRender("EdgeComponent");

    expect(tracker.getRenderCount("NodeComponent")).toBe(2);
    expect(tracker.getRenderCount("EdgeComponent")).toBe(1);
  });

  it("resets counts", () => {
    const tracker = new RenderTracker();
    tracker.recordRender("Test");
    tracker.reset();
    expect(tracker.getRenderCount("Test")).toBe(0);
  });
});

describe("PerformanceMonitor", () => {
  it("provides combined metrics", () => {
    const monitor = new PerformanceMonitor();

    monitor.startFrame();
    monitor.endFrame();

    const metrics = monitor.getMetrics();
    expect(metrics).toHaveProperty("fps");
    expect(metrics).toHaveProperty("frameTime");
    expect(metrics).toHaveProperty("renderCounts");
  });
});
