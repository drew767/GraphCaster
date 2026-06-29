// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (opts && typeof (opts as { defaultValue?: string }).defaultValue === "string") {
        return (opts as { defaultValue: string }).defaultValue;
      }
      return k;
    },
  }),
}));

let mockSession: {
  consoleLines: string[];
  pythonBanner: string | null;
  replaySourceLabel: string | null;
} = { consoleLines: [], pythonBanner: null, replaySourceLabel: null };

const mockClear = vi.fn();

vi.mock("../run/runSessionStore", () => ({
  useRunSessionConsole: () => mockSession,
  runSessionClearConsole: () => mockClear(),
}));

vi.mock("./ExecutionTimeline", () => ({
  ExecutionTimeline: ({ rows }: { rows: unknown[] }) => (
    <div data-testid="execution-timeline">{rows.length} rows</div>
  ),
}));

vi.mock("../run/buildRunTimeline", () => ({
  reduceConsoleLinesToRunTimeline: () => [],
}));

vi.mock("../lib/errorMessages", () => ({
  gcErrorTranslationKey: (code: string) => `errors.${code}`,
}));

vi.mock("../lib/jsonConsoleHighlight", () => ({
  jsonHighlightedConsoleLine: (line: string) => line,
}));

import { ConsolePanel } from "./ConsolePanel";

function renderPanel(
  overrides: Partial<{ heightPx: number; onNavigateToNode: (id: string) => void }> = {},
) {
  const onResizeStart = vi.fn();
  return render(
    <ConsolePanel
      heightPx={overrides.heightPx ?? 300}
      onResizeStart={onResizeStart}
      onNavigateToNode={overrides.onNavigateToNode}
    />,
  );
}

beforeEach(() => {
  mockSession = { consoleLines: [], pythonBanner: null, replaySourceLabel: null };
  mockClear.mockClear();
  vi.clearAllMocks();
});

describe("ConsolePanel", () => {
  it("renders empty state when no lines", () => {
    renderPanel();
    expect(screen.getByText("app.console.empty")).toBeInTheDocument();
  });

  it("renders log lines unvirtualized below the threshold", () => {
    mockSession = {
      consoleLines: ["hello", "world", "another"],
      pythonBanner: null,
      replaySourceLabel: null,
    };
    renderPanel();
    const lines = screen.getAllByTestId("gc-console-line");
    expect(lines.length).toBe(3);
    const body = lines[0]!.closest(".gc-console-body");
    expect(body?.textContent).toContain("hello");
    expect(body?.textContent).toContain("world");
  });

  it("clears console on clear button click", () => {
    mockSession = {
      consoleLines: ["line1"],
      pythonBanner: null,
      replaySourceLabel: null,
    };
    renderPanel();
    const clearBtn = screen.getByRole("button", { name: "app.console.clear" });
    fireEvent.click(clearBtn);
    expect(mockClear).toHaveBeenCalledOnce();
  });

  it("renders fewer than 100 DOM rows for 500 log lines (virtualization active)", () => {
    const lines: string[] = [];
    for (let i = 0; i < 500; i += 1) {
      lines.push(`line ${i}`);
    }
    mockSession = { consoleLines: lines, pythonBanner: null, replaySourceLabel: null };
    renderPanel();
    const rendered = screen.queryAllByTestId("gc-console-line");
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(100);
    expect(screen.getByTestId("gc-console-virtual-spacer")).toBeInTheDocument();
  });

  it("filter all/stderr/errors buttons toggle aria-pressed", () => {
    mockSession = { consoleLines: ["hi"], pythonBanner: null, replaySourceLabel: null };
    renderPanel();
    const stderrBtn = screen.getByRole("button", { name: "app.console.filterStderr" });
    expect(stderrBtn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(stderrBtn);
    expect(stderrBtn.getAttribute("aria-pressed")).toBe("true");
  });
});
