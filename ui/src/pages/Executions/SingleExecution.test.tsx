// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { SingleExecution } from "./SingleExecution";
import type { ExecutionPayload, ExecutionsApi } from "./executionsApi";
import { ToastProvider } from "../../toast/ToastProvider";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === "object") {
        let s = key;
        for (const [k, v] of Object.entries(opts)) {
          s = s.replace(`{{${k}}}`, String(v));
        }
        return s;
      }
      return key;
    },
  }),
}));

vi.mock("./ExecutionCanvas", () => ({
  ExecutionCanvas: ({
    onSelectNode,
  }: {
    onSelectNode: (id: string) => void;
  }) => (
    <div data-testid="gc-exec-canvas">
      <button type="button" onClick={() => onSelectNode("n2")} data-testid="mock-canvas-pick-n2">
        select n2
      </button>
    </div>
  ),
}));

const sampleExecution: ExecutionPayload = {
  runId: "run-1",
  workflowId: "wf-1",
  workflowName: "My Workflow",
  status: "success",
  startedAt: "2026-05-12T10:00:00.000Z",
  finishedAt: "2026-05-12T10:00:10.000Z",
  durationMs: 10_000,
  nodes: [
    {
      id: "n1",
      name: "Start",
      status: "success",
      durationMs: 100,
      input: { hello: "world" },
      output: { ok: true },
      parameters: { p: 1 },
    },
    {
      id: "n2",
      name: "Step Two",
      status: "error",
      durationMs: 500,
      input: { from: "n1" },
      output: null,
      error: "boom",
    },
  ],
};

function renderWithProviders(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("SingleExecution", () => {
  it("renders header, node list, canvas, and (after select) NDV drawer", async () => {
    renderWithProviders(
      <SingleExecution runIdOverride="run-1" payloadOverride={sampleExecution} />,
    );

    // Header
    expect(screen.getByTestId("gc-exec-header")).toBeInTheDocument();
    expect(screen.getByTestId("gc-exec-header-workflow-link")).toHaveTextContent("My Workflow");
    expect(screen.getByTestId("gc-exec-header-runid")).toHaveTextContent("run-1");

    // Node list
    expect(screen.getByTestId("gc-exec-nodelist")).toBeInTheDocument();
    expect(screen.getByTestId("gc-exec-node-row-n1")).toHaveTextContent("Start");
    expect(screen.getByTestId("gc-exec-node-row-n2")).toHaveTextContent("Step Two");

    // Canvas (mocked)
    expect(screen.getByTestId("gc-exec-canvas")).toBeInTheDocument();

    // Drawer closed initially
    expect(screen.queryByTestId("gc-exec-ndv")).not.toBeInTheDocument();

    // Selecting a node opens NDV
    fireEvent.click(screen.getByTestId("gc-exec-node-row-n2"));
    expect(screen.getByTestId("gc-exec-ndv")).toBeInTheDocument();
    expect(screen.getByTestId("gc-exec-ndv-input")).toHaveTextContent(/from/);
  });

  it("retry button invokes retry handler", async () => {
    const retry = vi.fn().mockResolvedValue({ newRunId: "run-2" });
    const api: ExecutionsApi = {
      getExecution: vi.fn().mockResolvedValue(sampleExecution),
      retry,
      delete: vi.fn().mockResolvedValue(undefined),
    };

    renderWithProviders(
      <SingleExecution
        runIdOverride="run-1"
        payloadOverride={sampleExecution}
        apiOverride={api}
        handlersOverride={{
          onRetry: (opts) => retry("run-1", opts),
        }}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("gc-exec-header-retry"));
    });

    expect(retry).toHaveBeenCalled();
    expect(retry.mock.calls[0][0]).toBe("run-1");
  });

  it("Show raw button opens RawRunModal", () => {
    renderWithProviders(
      <SingleExecution runIdOverride="run-1" payloadOverride={sampleExecution} />,
    );

    expect(screen.queryByTestId("gc-raw-run-modal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("gc-exec-header-show-raw"));
    expect(screen.getByTestId("gc-raw-run-modal")).toBeInTheDocument();
    expect(screen.getByTestId("gc-raw-run-pre")).toHaveTextContent(/"runId": "run-1"/);
  });
});
