// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";

import {
  ActivityFeedBridge,
  handleActivityEvent,
} from "./ActivityFeedBridge";
import { useRunStore } from "../../stores/runStore";
import type { ActivityEvent } from "../../services/activityFeed";

function makeFakeClient() {
  const handlers = new Set<(e: ActivityEvent) => void>();
  return {
    on(h: (e: ActivityEvent) => void) {
      handlers.add(h);
      return () => handlers.delete(h);
    },
    emit(e: ActivityEvent) {
      for (const h of handlers) h(e);
    },
  };
}

beforeEach(() => {
  useRunStore.getState().clearNodeStatuses();
});

describe("handleActivityEvent — node status mapping", () => {
  it("sets running on run.node.started", () => {
    handleActivityEvent({
      type: "run.node.started",
      payload: { nodeId: "n1" },
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(useRunStore.getState().statusByNode["n1"]).toBe("running");
  });

  it("sets success on run.node.finished status:success", () => {
    handleActivityEvent({
      type: "run.node.finished",
      payload: { nodeId: "n2", status: "success" },
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(useRunStore.getState().statusByNode["n2"]).toBe("success");
  });

  it("sets error on run.node.finished status:error", () => {
    handleActivityEvent({
      type: "run.node.finished",
      payload: { nodeId: "n3", status: "error" },
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(useRunStore.getState().statusByNode["n3"]).toBe("error");
  });

  it("ignores events without nodeId", () => {
    handleActivityEvent({
      type: "run.node.started",
      payload: {},
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(useRunStore.getState().statusByNode).toEqual({});
  });
});

describe("ActivityFeedBridge — wiring", () => {
  it("subscribes to client and updates store on events", () => {
    const client = makeFakeClient();
    render(<ActivityFeedBridge client={client} />);

    client.emit({
      type: "run.node.started",
      payload: { nodeId: "a" },
      timestamp: "2026-01-01T00:00:00Z",
    });
    client.emit({
      type: "run.node.finished",
      payload: { nodeId: "a", status: "success" },
      timestamp: "2026-01-01T00:00:00Z",
    });

    expect(useRunStore.getState().statusByNode["a"]).toBe("success");
  });
});
