// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      typeof opts?.defaultValue === "string" ? opts.defaultValue : key,
  }),
}));

import { EventTimeline } from "../EventTimeline";
import type { HistoryRunEvent } from "../../../stores/historyStore";

function makeEvents(n: number): HistoryRunEvent[] {
  const out: HistoryRunEvent[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      type: "node_started",
      runId: "r1",
      nodeId: `n${i}`,
      timestamp: "",
      data: {},
      index: i,
    });
  }
  return out;
}

describe("EventTimeline virtualization", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders all events when under the virtualize threshold", () => {
    render(
      <EventTimeline
        events={makeEvents(40)}
        currentIndex={0}
        onSeek={() => {}}
        onStepForward={() => {}}
        onStepBackward={() => {}}
      />,
    );
    const items = screen.getAllByTestId("gc-timeline-event");
    expect(items.length).toBe(40);
  });

  it("renders fewer than 100 DOM rows for 500 events (virtualization active)", () => {
    render(
      <EventTimeline
        events={makeEvents(500)}
        currentIndex={0}
        onSeek={() => {}}
        onStepForward={() => {}}
        onStepBackward={() => {}}
      />,
    );
    const items = screen.queryAllByTestId("gc-timeline-event");
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(100);
  });

  it("renders counter with full event count even when virtualized", () => {
    render(
      <EventTimeline
        events={makeEvents(500)}
        currentIndex={0}
        onSeek={() => {}}
        onStepForward={() => {}}
        onStepBackward={() => {}}
      />,
    );
    expect(screen.getByText("1 / 500")).toBeInTheDocument();
  });
});
