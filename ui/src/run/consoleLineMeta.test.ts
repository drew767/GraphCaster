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

  it("marks error event", () => {
    const m = buildConsoleLineMeta(`{"type":"error","nodeId":"x","message":"bad"}`);
    expect(m.isErrorLike).toBe(true);
    expect(m.nodeId).toBe("x");
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
