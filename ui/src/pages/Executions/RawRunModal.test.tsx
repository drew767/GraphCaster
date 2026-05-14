// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { RawRunModal } from "./RawRunModal";
import type { ExecutionPayload } from "./executionsApi";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const samplePayload: ExecutionPayload = {
  runId: "run-xyz",
  workflowId: "wf",
  workflowName: "wf",
  status: "success",
  startedAt: "2026-05-12T10:00:00.000Z",
  durationMs: 100,
  nodes: [
    { id: "n1", name: "N1", status: "success", durationMs: 10 },
  ],
};

describe("RawRunModal", () => {
  beforeEach(() => {
    // mock clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("renders raw JSON when open", () => {
    render(<RawRunModal open={true} onClose={() => {}} payload={samplePayload} />);
    expect(screen.getByTestId("gc-raw-run-modal")).toBeInTheDocument();
    expect(screen.getByTestId("gc-raw-run-pre")).toHaveTextContent(/"runId": "run-xyz"/);
  });

  it("does not render when closed", () => {
    render(<RawRunModal open={false} onClose={() => {}} payload={samplePayload} />);
    expect(screen.queryByTestId("gc-raw-run-modal")).not.toBeInTheDocument();
  });

  it("copy button writes JSON to clipboard", async () => {
    const onCopied = vi.fn();
    render(
      <RawRunModal
        open={true}
        onClose={() => {}}
        payload={samplePayload}
        onCopied={onCopied}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("gc-raw-run-copy"));
    });

    const writeText = (navigator.clipboard as unknown as { writeText: ReturnType<typeof vi.fn> })
      .writeText;
    expect(writeText).toHaveBeenCalledTimes(1);
    const arg = writeText.mock.calls[0][0];
    expect(arg).toContain('"runId": "run-xyz"');
    expect(onCopied).toHaveBeenCalledWith(true);
  });

  it("search filters lines", () => {
    render(<RawRunModal open={true} onClose={() => {}} payload={samplePayload} />);
    fireEvent.change(screen.getByTestId("gc-raw-run-search"), { target: { value: "runId" } });
    const pre = screen.getByTestId("gc-raw-run-pre");
    expect(pre.textContent).toContain("runId");
    expect(pre.textContent).not.toContain("workflowName");
  });
});
