// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";

import { dispatchBrokerWebSocketJson } from "./webRunBrokerDispatch";

describe("dispatchBrokerWebSocketJson", () => {
  it("routes stdout to append and ndjson", () => {
    const appendLine = vi.fn();
    const applyNdjson = vi.fn();
    const onExit = vi.fn();
    const done = dispatchBrokerWebSocketJson(
      "r1",
      { runId: "r1", channel: "stdout", line: '{"type":"run_started"}' },
      { appendLine, applyNdjson, onExit },
    );
    expect(done).toBe(false);
    expect(appendLine).toHaveBeenCalledWith('{"type":"run_started"}');
    expect(applyNdjson).toHaveBeenCalledWith('{"type":"run_started"}', "r1");
    expect(onExit).not.toHaveBeenCalled();
  });

  it("routes stderr payload line", () => {
    const appendLine = vi.fn();
    const done = dispatchBrokerWebSocketJson(
      "r1",
      { runId: "r1", channel: "stderr", payload: { line: "oops" } },
      {
        appendLine,
        applyNdjson: vi.fn(),
        onExit: vi.fn(),
      },
    );
    expect(done).toBe(false);
    expect(appendLine).toHaveBeenCalledWith("[stderr] oops");
  });

  it("routes exit and returns true", () => {
    const onExit = vi.fn();
    const done = dispatchBrokerWebSocketJson(
      "r1",
      { runId: "r1", channel: "exit", code: 0 },
      { appendLine: vi.fn(), applyNdjson: vi.fn(), onExit },
    );
    expect(done).toBe(true);
    expect(onExit).toHaveBeenCalledWith(0);
  });

  it("ignores wrong runId", () => {
    const appendLine = vi.fn();
    dispatchBrokerWebSocketJson(
      "r1",
      { runId: "other", channel: "stdout", line: "x" },
      { appendLine, applyNdjson: vi.fn(), onExit: vi.fn() },
    );
    expect(appendLine).not.toHaveBeenCalled();
  });
});
