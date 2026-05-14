// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { WorkflowDiffView } from "./WorkflowDiffView";
import type { WorkflowVersion, DiffResult } from "./WorkflowDiffView";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts) {
        return Object.entries(opts).reduce<string>(
          (s, [k, v]) => s.replace(`{{${k}}}`, String(v)),
          key,
        );
      }
      return key;
    },
  }),
}));

// Mock Icon to a lightweight stub (avoids loading the full SVG registry)
vi.mock("../ui/Icon/Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

// Mock Select to avoid Radix UI portal overhead
vi.mock("../ui/Select/Select", () => ({
  Select: ({ value, onValueChange, options, "aria-label": ariaLabel, "data-testid": testId }: {
    value?: string;
    onValueChange?: (v: string) => void;
    options: Array<{ value: string; label: string }>;
    "aria-label"?: string;
    "data-testid"?: string;
  }) => (
    <select
      value={value}
      onChange={(e) => onValueChange?.(e.target.value)}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  ),
}));

const toastWarningMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("../../toast/ToastProvider", () => ({
  useToast: () => ({
    toast: {
      show: vi.fn(),
      success: vi.fn(),
      error: toastErrorMock,
      warning: toastWarningMock,
      info: vi.fn(),
      dismiss: vi.fn(),
      dismissAll: vi.fn(),
    },
    push: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const versions: WorkflowVersion[] = [
  { version: 3, label: "v3" },
  { version: 2, label: "v2" },
  { version: 1, label: "v1" },
];

const sampleDiff: DiffResult = {
  nodesAdded: [{ id: "n5", name: "New LLM node" }],
  nodesRemoved: [{ id: "n3", name: "Old task" }],
  nodesModified: [
    {
      id: "n1",
      name: "Start",
      fields: [
        { key: "label", before: "Begin", after: "Start" },
      ],
    },
  ],
  edgesAdded: [{ id: "e10", description: "n5 → exit" }],
  edgesRemoved: [{ id: "e3", description: "n3 → exit" }],
};

function mockFetch(data: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => data,
    }),
  );
}

function renderDiff(props: Partial<React.ComponentProps<typeof WorkflowDiffView>> = {}) {
  return render(
    <WorkflowDiffView
      graphId="graph-1"
      versions={versions}
      initialVersionA={3}
      initialVersionB={2}
      {...props}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkflowDiffView", () => {
  it("renders diff sections after loading", async () => {
    mockFetch(sampleDiff);
    renderDiff();

    await waitFor(() => expect(screen.getByTestId("diff-section-added")).toBeInTheDocument());
    expect(screen.getByTestId("diff-section-removed")).toBeInTheDocument();
    expect(screen.getByTestId("diff-section-modified")).toBeInTheDocument();
    expect(screen.getByTestId("diff-section-edges")).toBeInTheDocument();
  });

  it("renders added, removed, and edge nodes correctly", async () => {
    mockFetch(sampleDiff);
    renderDiff();

    await waitFor(() => expect(screen.getByTestId("diff-added-n5")).toBeInTheDocument());
    expect(screen.getByTestId("diff-removed-n3")).toBeInTheDocument();
    expect(screen.getByTestId("diff-edge-added-e10")).toBeInTheDocument();
    expect(screen.getByTestId("diff-edge-removed-e3")).toBeInTheDocument();
  });

  it("renders modified node card", async () => {
    mockFetch(sampleDiff);
    renderDiff();

    await waitFor(() => expect(screen.getByTestId("diff-modified-n1")).toBeInTheDocument());
  });

  it("expands modified node card to show field-level diff", async () => {
    mockFetch(sampleDiff);
    renderDiff();

    await waitFor(() => expect(screen.getByTestId("diff-modified-toggle-n1")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId("diff-modified-toggle-n1"));
    });

    expect(screen.getByTestId("diff-field-label")).toBeInTheDocument();
    expect(screen.getByTestId("diff-field-before-label")).toHaveTextContent("Begin");
    expect(screen.getByTestId("diff-field-after-label")).toHaveTextContent("Start");
  });

  it("shows warning toast and empty state on 404 from diff endpoint", async () => {
    mockFetch({}, 404);
    renderDiff();

    await waitFor(() =>
      expect(toastWarningMock).toHaveBeenCalledWith(
        "app.workflows.versioning.diffNotFound",
      ),
    );
    expect(screen.getByTestId("diff-empty")).toBeInTheDocument();
  });

  it("renders version selector dropdowns in header", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    renderDiff();

    expect(screen.getByTestId("diff-select-a")).toBeInTheDocument();
    expect(screen.getByTestId("diff-select-b")).toBeInTheDocument();
  });
});
