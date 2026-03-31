// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { createNdjsonSeqReorderSink, extractSeqFromNdjsonLine } from "./ndjsonSeqReorder";

describe("extractSeqFromNdjsonLine", () => {
  it("returns null when no seq", () => {
    expect(extractSeqFromNdjsonLine('{"type":"run_started","runId":"r"}')).toBeNull();
  });

  it("returns integer seq", () => {
    expect(
      extractSeqFromNdjsonLine(
        '{"type":"process_output","runId":"r","nodeId":"n","graphId":"g","stream":"stdout","text":"a","seq":2}',
      ),
    ).toBe(2);
  });
});

describe("createNdjsonSeqReorderSink", () => {
  it("passes through lines without seq in arrival order", () => {
    const out: string[] = [];
    const sink = createNdjsonSeqReorderSink((l) => void out.push(l));
    sink.accept("plain log");
    sink.accept('{"type":"x"}');
    expect(out).toEqual(["plain log", '{"type":"x"}']);
  });

  it("reorders three out-of-order seq lines", () => {
    const out: string[] = [];
    const sink = createNdjsonSeqReorderSink((l) => void out.push(l));
    const l1 =
      '{"type":"process_output","runId":"r","nodeId":"n","graphId":"g","stream":"stdout","text":"a","seq":1}';
    const l2 =
      '{"type":"process_output","runId":"r","nodeId":"n","graphId":"g","stream":"stdout","text":"b","seq":2}';
    const l3 =
      '{"type":"process_output","runId":"r","nodeId":"n","graphId":"g","stream":"stdout","text":"c","seq":3}';
    sink.accept(l3);
    sink.accept(l1);
    expect(out).toEqual([l1]);
    sink.accept(l2);
    expect(out).toEqual([l1, l2, l3]);
  });

  it("drops duplicate seq", () => {
    const out: string[] = [];
    const sink = createNdjsonSeqReorderSink((l) => void out.push(l));
    const l1 =
      '{"type":"process_output","runId":"r","nodeId":"n","graphId":"g","stream":"stdout","text":"a","seq":1}';
    sink.accept(l1);
    sink.accept(l1);
    expect(out).toEqual([l1]);
  });

  it("reset clears state", () => {
    const out: string[] = [];
    const sink = createNdjsonSeqReorderSink((l) => void out.push(l));
    const l2 =
      '{"type":"process_output","runId":"r","nodeId":"n","graphId":"g","stream":"stdout","text":"b","seq":2}';
    sink.accept(l2);
    expect(out).toEqual([]);
    sink.reset();
    const l1 =
      '{"type":"process_output","runId":"r","nodeId":"n","graphId":"g","stream":"stdout","text":"a","seq":1}';
    sink.accept(l1);
    expect(out).toEqual([l1]);
  });
});
