// Copyright GraphCaster. All Rights Reserved.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExecutionTimeline } from "./ExecutionTimeline";
import type { RunTimelineRow } from "../run/buildRunTimeline";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === "app.console.timelineStatus.success") {
        return "Succeeded";
      }
      if (key === "app.console.timelineStatus.failed") {
        return "Failed";
      }
      if (key.startsWith("app.console.timelineRowAria")) {
        return "aria";
      }
      return key;
    },
  }),
}));

describe("ExecutionTimeline", () => {
  it("renders rows with translated status and duration bar when durations exist", () => {
    const rows: RunTimelineRow[] = [
      {
        id: "1",
        nodeId: "n1",
        nodeType: "task",
        status: "success",
        startedLineIndex: 0,
        endedLineIndex: 2,
        durationMs: 100,
      },
      {
        id: "2",
        nodeId: "n2",
        nodeType: "exit",
        status: "failed",
        startedLineIndex: 3,
        endedLineIndex: 4,
        durationMs: 50,
      },
    ];
    render(<ExecutionTimeline rows={rows} />);
    expect(screen.getByTestId("gc-execution-timeline")).toBeInTheDocument();
    const row1 = screen.getByTestId("gc-timeline-row-n1");
    expect(row1).toHaveTextContent("n1");
    expect(within(row1).getByTitle("Succeeded")).toBeInTheDocument();
    const row2 = screen.getByTestId("gc-timeline-row-n2");
    expect(within(row2).getByTitle("Failed")).toBeInTheDocument();
    const bars = screen.getAllByTestId("gc-timeline-duration-bar");
    expect(bars.length).toBe(2);
  });

  it("calls onNavigateToNode when row clicked", () => {
    const onNav = vi.fn();
    const rows: RunTimelineRow[] = [
      {
        id: "1",
        nodeId: "x1",
        nodeType: "task",
        status: "success",
        startedLineIndex: 0,
        endedLineIndex: 1,
      },
    ];
    render(<ExecutionTimeline rows={rows} onNavigateToNode={onNav} />);
    fireEvent.click(screen.getByTestId("gc-timeline-row-x1"));
    expect(onNav).toHaveBeenCalledWith("x1");
  });
});
