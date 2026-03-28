// Copyright GraphCaster. All Rights Reserved.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyRunnerNdjsonSideEffects } from "./runEventSideEffects";
import { parseRunEventLine } from "./parseRunEventLine";
import * as store from "./runSessionStore";

const _dir = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(_dir, "../../../schemas/test-fixtures/coordinator-worker-lost-run-finished.json");

describe("coordinator worker_lost run_finished", () => {
  it("parses fixture and clears active node like normal run_finished", () => {
    const line = readFileSync(fixturePath, "utf-8").trim();
    const ev = parseRunEventLine(line);
    expect(ev).toBeTruthy();
    expect((ev as { type?: string }).type).toBe("run_finished");
    expect((ev as { coordinatorWorkerLost?: boolean }).coordinatorWorkerLost).toBe(true);
    expect((ev as { reason?: string }).reason).toBe("coordinator_worker_lost");

    store.runSessionResetForTest();
    store.runSessionRegisterLiveRun("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    store.runSessionSetActiveNodeIdForRun("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "n1");
    applyRunnerNdjsonSideEffects(line, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(store.getRunSessionSnapshot().activeNodeId).toBe(null);
  });
});
