// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { ndjsonTextToRunEvents } from "./ndjsonRunEvents";

describe("ndjsonTextToRunEvents", () => {
  it("parses run event lines", () => {
    const text = [
      '{"type":"run_started","runId":"r1","timestamp":"2026-03-30T10:00:00Z"}',
      '{"type":"step_started","runId":"r1","nodeId":"A","timestamp":"2026-03-30T10:00:01Z"}',
      "",
    ].join("\n");
    const ev = ndjsonTextToRunEvents(text);
    expect(ev).toHaveLength(2);
    expect(ev[0].type).toBe("run_started");
    expect(ev[1].nodeId).toBe("A");
  });
});
