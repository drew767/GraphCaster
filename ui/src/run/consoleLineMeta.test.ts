// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import {
  buildConsoleLineMeta,
  consoleLineMatchesSearch,
  passesConsoleFilter,
  splitStderrPrefix,
  STDERR_PREFIX,
} from "./consoleLineMeta";

describe("splitStderrPrefix", () => {
  it("detects stderr prefix", () => {
    expect(splitStderrPrefix(`${STDERR_PREFIX}{}`)).toEqual({ isStderr: true, payload: "{}" });
  });

  it("leaves stdout payload", () => {
    expect(splitStderrPrefix(`{"type":"x"}`)).toEqual({ isStderr: false, payload: `{"type":"x"}` });
  });
});

describe("buildConsoleLineMeta", () => {
  it("parses nodeId from node_execute", () => {
    const line = `{"type":"node_execute","nodeId":"n1","nodeType":"task","data":{}}`;
    const m = buildConsoleLineMeta(line);
    expect(m.nodeId).toBe("n1");
    expect(m.parsedType).toBe("node_execute");
    expect(m.isStderr).toBe(false);
    expect(m.isErrorLike).toBe(false);
  });

  it("parses nodeId from branch_taken via fromNode", () => {
    const m = buildConsoleLineMeta(
      `{"type":"branch_taken","edgeId":"e1","fromNode":"src","toNode":"dst","graphId":"g"}`,
    );
    expect(m.nodeId).toBe("src");
    expect(m.parsedType).toBe("branch_taken");
    expect(m.isErrorLike).toBe(false);
  });

  it("parses nodeId from structure_warning fork_parallel via forkNodeId", () => {
    const m = buildConsoleLineMeta(
      `{"type":"structure_warning","kind":"fork_parallel_deferred","forkNodeId":"f1","reason":"multi_hop","graphId":"g"}`,
    );
    expect(m.nodeId).toBe("f1");
    expect(m.parsedType).toBe("structure_warning");
  });

  it("marks branch_taken with route error as error-like", () => {
    const m = buildConsoleLineMeta(
      `{"type":"branch_taken","edgeId":"e1","fromNode":"src","toNode":"dst","graphId":"g","route":"error"}`,
    );
    expect(m.nodeId).toBe("src");
    expect(m.isErrorLike).toBe(true);
  });

  it("marks stderr as error-like", () => {
    const m = buildConsoleLineMeta(`${STDERR_PREFIX}oops`);
    expect(m.isStderr).toBe(true);
    expect(m.isErrorLike).toBe(true);
  });

  it("marks run_finished failed", () => {
    const m = buildConsoleLineMeta(`{"type":"run_finished","status":"failed","rootGraphId":"g"}`);
    expect(m.isErrorLike).toBe(true);
  });

  it("marks process_complete with success false", () => {
    const m = buildConsoleLineMeta(
      `{"type":"process_complete","nodeId":"t","success":false,"processResult":{"exitCode":1}}`,
    );
    expect(m.isErrorLike).toBe(true);
    expect(m.nodeId).toBe("t");
  });

  it("parses stream_backpressure for console warning", () => {
    const line = `{"type":"stream_backpressure","runId":"r1","droppedOutputLines":15,"reason":"subscriber_queue_full"}`;
    const m = buildConsoleLineMeta(line);
    expect(m.parsedType).toBe("stream_backpressure");
    expect(m.streamBackpressureDropped).toBe(15);
    expect(m.isErrorLike).toBe(false);
    expect(m.displayLine).toBe(line);
    expect(consoleLineMatchesSearch(m, "dropped")).toBe(true);
    expect(consoleLineMatchesSearch(m, "отброшено")).toBe(true);
    expect(consoleLineMatchesSearch(m, "subscriber")).toBe(true);
  });

  it("formats process_output stdout for display", () => {
    const line = `{"type":"process_output","runId":"r","nodeId":"t1","graphId":"g","stream":"stdout","text":"hi\\n","seq":0,"eol":true}`;
    const m = buildConsoleLineMeta(line);
    expect(m.displayLine).toBe("[t1] hi\n");
    expect(m.isStderr).toBe(false);
    expect(m.parsedType).toBe("process_output");
  });

  it("formats process_output stderr for display", () => {
    const line = `{"type":"process_output","runId":"r","nodeId":"t1","graphId":"g","stream":"stderr","text":"w\\n","seq":0}`;
    const m = buildConsoleLineMeta(line);
    expect(m.displayLine).toBe(`${STDERR_PREFIX}[t1] w\n`);
    expect(m.isStderr).toBe(true);
    expect(passesConsoleFilter(m, "stderr")).toBe(true);
  });

  it("marks error event", () => {
    const m = buildConsoleLineMeta(`{"type":"error","nodeId":"x","message":"bad"}`);
    expect(m.isErrorLike).toBe(true);
    expect(m.nodeId).toBe("x");
  });

  it("marks agent_failed as error-like", () => {
    const m = buildConsoleLineMeta(
      `{"type":"agent_failed","nodeId":"la1","graphId":"g1","attempt":0,"message":"boom"}`,
    );
    expect(m.isErrorLike).toBe(true);
    expect(m.nodeId).toBe("la1");
    expect(passesConsoleFilter(m, "errors")).toBe(true);
  });

  it("formats agent_step for display", () => {
    const line = `{"type":"agent_step","nodeId":"la1","graphId":"g1","attempt":0,"phase":"llm","message":"ok"}`;
    const m = buildConsoleLineMeta(line);
    expect(m.displayLine).toBe("[la1] agent_step phase=llm message=ok");
    expect(m.isErrorLike).toBe(false);
  });

  it("truncates long agent_step message in displayLine", () => {
    const msg = "x".repeat(400);
    const line = JSON.stringify({
      type: "agent_step",
      nodeId: "la1",
      graphId: "g1",
      attempt: 0,
      phase: "llm",
      message: msg,
    });
    const m = buildConsoleLineMeta(line);
    expect(m.rawLine).toBe(line);
    expect(m.displayLine.length).toBeLessThan(line.length);
    expect(m.displayLine.endsWith("...")).toBe(true);
    expect(m.displayLine.startsWith("[la1] agent_step phase=llm message=")).toBe(true);
  });

  it("treats empty line as non-json meta", () => {
    const m = buildConsoleLineMeta("");
    expect(m.parsedType).toBeNull();
    expect(m.isErrorLike).toBe(false);
  });

  it("detects failed status substring in raw line", () => {
    const m = buildConsoleLineMeta(`something "status":"failed" tail`);
    expect(m.isErrorLike).toBe(true);
  });

  it("marks run_end with no matching edge as error-like", () => {
    const m = buildConsoleLineMeta(
      `{"type":"run_end","reason":"no_outgoing_or_no_matching_condition"}`,
    );
    expect(m.isErrorLike).toBe(true);
  });

  it("does not mark run_end cancel as error-like", () => {
    const m = buildConsoleLineMeta(`{"type":"run_end","reason":"cancel_requested"}`);
    expect(m.isErrorLike).toBe(false);
  });

  it("does not mark run_finished cancelled as error-like", () => {
    const m = buildConsoleLineMeta(
      `{"type":"run_finished","status":"cancelled","rootGraphId":"g"}`,
    );
    expect(m.isErrorLike).toBe(false);
  });

  it("does not mark run_finished partial as error-like", () => {
    const m = buildConsoleLineMeta(
      `{"type":"run_finished","status":"partial","rootGraphId":"g"}`,
    );
    expect(m.isErrorLike).toBe(false);
  });

  it("does not mark successful run_finished as error-like", () => {
    const m = buildConsoleLineMeta(
      `{"type":"run_finished","status":"success","rootGraphId":"g"}`,
    );
    expect(m.isErrorLike).toBe(false);
  });
});

describe("passesConsoleFilter and search", () => {
  it("filters stderr mode", () => {
    const a = buildConsoleLineMeta(`${STDERR_PREFIX}x`);
    const b = buildConsoleLineMeta(`{"type":"run_started"}`);
    expect(passesConsoleFilter(a, "stderr")).toBe(true);
    expect(passesConsoleFilter(b, "stderr")).toBe(false);
  });

  it("search is case insensitive", () => {
    const m = buildConsoleLineMeta(`{"type":"node_enter","nodeId":"AbC"}`);
    expect(consoleLineMatchesSearch(m, "abc")).toBe(true);
    expect(consoleLineMatchesSearch(m, "nomatch")).toBe(false);
  });

  it("errors mode excludes successful run_started", () => {
    const m = buildConsoleLineMeta(`{"type":"run_started","runId":"x"}`);
    expect(passesConsoleFilter(m, "errors")).toBe(false);
  });

  it("errors mode includes stderr line", () => {
    const m = buildConsoleLineMeta(`${STDERR_PREFIX}{}`);
    expect(passesConsoleFilter(m, "errors")).toBe(true);
  });
});
