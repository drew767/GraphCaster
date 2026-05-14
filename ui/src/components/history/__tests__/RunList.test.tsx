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

import { RunList } from "../RunList";
import type { RunSummary } from "../../../stores/historyStore";

function makeRuns(n: number): RunSummary[] {
  const out: RunSummary[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      runId: `run-${i}`,
      graphId: "g1",
      graphName: `Run #${i}`,
      status: "completed",
      startedAt: "2026-05-01T00:00:00Z",
      eventCount: 0,
      trigger: "manual",
    });
  }
  return out;
}

describe("RunList virtualization", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders all rows when under the virtualize threshold", () => {
    render(<RunList runs={makeRuns(50)} selectedId={null} onSelect={() => {}} isLoading={false} />);
    const items = screen.getAllByTestId("gc-run-list-item");
    expect(items.length).toBe(50);
  });

  it("renders fewer than 100 DOM rows for 500 entries (virtualization active)", () => {
    render(<RunList runs={makeRuns(500)} selectedId={null} onSelect={() => {}} isLoading={false} />);
    const items = screen.queryAllByTestId("gc-run-list-item");
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(100);
  });

  it("shows empty state when no runs", () => {
    render(<RunList runs={[]} selectedId={null} onSelect={() => {}} isLoading={false} />);
    expect(screen.getByText("app.runHistory.empty")).toBeInTheDocument();
  });

  it("shows loading state when isLoading", () => {
    render(<RunList runs={[]} selectedId={null} onSelect={() => {}} isLoading />);
    expect(screen.getByText("app.runHistory.loading")).toBeInTheDocument();
  });
});
