// Copyright GraphCaster. All Rights Reserved.

import { beforeEach, describe, expect, it } from "vitest";

import {
  _resetTelemetryForTests,
  disableTelemetry,
  enableTelemetry,
  getRecentEvents,
  isTelemetryEnabled,
  track,
} from "./index";

describe("telemetry", () => {
  beforeEach(() => {
    _resetTelemetryForTests();
  });

  it("is disabled by default", () => {
    expect(isTelemetryEnabled()).toBe(false);
  });

  it("ignores events when disabled", () => {
    track({ type: "page.viewed", route: "/test" });
    expect(getRecentEvents()).toHaveLength(0);
  });

  it("stores events when enabled", () => {
    enableTelemetry();
    expect(isTelemetryEnabled()).toBe(true);

    track({ type: "page.viewed", route: "/test" });
    track({ type: "node.added", nodeType: "task" });

    const events = getRecentEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "page.viewed", route: "/test" });
    expect(events[1]).toEqual({ type: "node.added", nodeType: "task" });
  });

  it("stops recording after disableTelemetry", () => {
    enableTelemetry();
    track({ type: "page.viewed", route: "/a" });
    disableTelemetry();
    track({ type: "page.viewed", route: "/b" });

    expect(getRecentEvents()).toHaveLength(1);
    expect(isTelemetryEnabled()).toBe(false);
  });

  it("caps ring buffer at 200 events", () => {
    enableTelemetry();
    for (let i = 0; i < 250; i += 1) {
      track({ type: "page.viewed", route: `/r${i}` });
    }
    const events = getRecentEvents();
    expect(events).toHaveLength(200);
    expect((events[0] as { route: string }).route).toBe("/r50");
    expect((events[199] as { route: string }).route).toBe("/r249");
  });
});
