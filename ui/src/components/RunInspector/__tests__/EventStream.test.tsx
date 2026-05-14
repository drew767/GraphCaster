// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EventStream } from "../EventStream";
import type { RunEvent } from "../traceTree";

function makeEvents(n: number): RunEvent[] {
  const out: RunEvent[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({ type: "node_started", ts: 1000 + i, nodeId: `n${i}` } as RunEvent);
  }
  return out;
}

describe("EventStream virtualization", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders empty state when no events", () => {
    render(<EventStream events={[]} />);
    expect(screen.getByTestId("gc-ri-events-empty")).toBeInTheDocument();
  });

  it("renders all events when under virtualize threshold", () => {
    render(<EventStream events={makeEvents(50)} />);
    expect(screen.getAllByTestId("gc-ri-event-stream-line").length).toBe(50);
  });

  it("renders fewer than 100 DOM rows for 500 events (virtualization active)", () => {
    render(<EventStream events={makeEvents(500)} />);
    const rendered = screen.queryAllByTestId("gc-ri-event-stream-line");
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(100);
  });
});
