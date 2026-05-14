// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { ActivityFeedClient, type ActivityEvent } from "./activityFeed";

// ---------------------------------------------------------------------------
// Minimal WebSocket mock
// ---------------------------------------------------------------------------

interface MockWsInstance {
  onopen: ((e: Event) => void) | null;
  onclose: ((e: CloseEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  close: Mock;
  _triggerOpen(): void;
  _triggerMessage(data: string): void;
  _triggerClose(): void;
  _triggerError(): void;
}

let lastWsInstance: MockWsInstance | null = null;

class MockWebSocket implements MockWsInstance {
  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  close = vi.fn();

  constructor() {
    lastWsInstance = this;
  }

  _triggerOpen(): void {
    this.onopen?.(new Event("open"));
  }

  _triggerMessage(data: string): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  _triggerClose(): void {
    this.onclose?.(new CloseEvent("close"));
  }

  _triggerError(): void {
    this.onerror?.(new Event("error"));
  }
}

beforeEach(() => {
  lastWsInstance = null;
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ActivityFeedClient — connects", () => {
  it("creates a WebSocket on connect()", () => {
    const client = new ActivityFeedClient("ws://localhost/api/v1/events/stream");
    expect(lastWsInstance).toBeNull();
    client.connect();
    expect(lastWsInstance).not.toBeNull();
    client.disconnect();
  });
});

describe("ActivityFeedClient — dispatches per event type", () => {
  it("calls handler for every supported event type", () => {
    const client = new ActivityFeedClient("ws://localhost/test");
    const handler = vi.fn();
    client.on(handler);
    client.connect();

    const types: ActivityEvent["type"][] = [
      "run.finished",
      "run.failed",
      "webhook.fired",
      "collab.user_joined",
      "plugin.updated",
      "system.message",
    ];

    for (const type of types) {
      const event: ActivityEvent = {
        type,
        payload: { workflow: "My Workflow" },
        timestamp: new Date().toISOString(),
      };
      lastWsInstance!._triggerMessage(JSON.stringify(event));
    }

    expect(handler).toHaveBeenCalledTimes(types.length);
    for (let i = 0; i < types.length; i++) {
      expect(handler.mock.calls[i][0].type).toBe(types[i]);
    }

    client.disconnect();
  });
});

describe("ActivityFeedClient — reconnect after disconnect", () => {
  it("reconnects when the socket closes unexpectedly", () => {
    const client = new ActivityFeedClient("ws://localhost/test");
    client.connect();
    const firstWs = lastWsInstance!;

    // Simulate unexpected server-side close
    firstWs._triggerClose();

    // Advance time past the reconnect delay
    vi.advanceTimersByTime(1500);

    const secondWs = lastWsInstance!;
    expect(secondWs).not.toBe(firstWs);

    client.disconnect();
  });
});

describe("ActivityFeedClient — parses JSON", () => {
  it("delivers parsed ActivityEvent objects to handlers", () => {
    const client = new ActivityFeedClient("ws://localhost/test");
    const handler = vi.fn();
    client.on(handler);
    client.connect();

    const payload = { workflow: "Test WF", runId: "abc-123" };
    const raw = JSON.stringify({
      type: "run.finished",
      payload,
      timestamp: "2026-01-01T00:00:00Z",
    });
    lastWsInstance!._triggerMessage(raw);

    expect(handler).toHaveBeenCalledOnce();
    const received = handler.mock.calls[0][0] as ActivityEvent;
    expect(received.type).toBe("run.finished");
    expect(received.payload).toEqual(payload);
    expect(received.timestamp).toBe("2026-01-01T00:00:00Z");

    client.disconnect();
  });
});

describe("ActivityFeedClient — handles errors gracefully", () => {
  it("does not throw when WebSocket emits an error event", () => {
    const client = new ActivityFeedClient("ws://localhost/test");
    const handler = vi.fn();
    client.on(handler);
    client.connect();

    expect(() => {
      lastWsInstance!._triggerError();
    }).not.toThrow();

    // Handler should not be called for errors
    expect(handler).not.toHaveBeenCalled();

    client.disconnect();
  });

  it("silently ignores malformed JSON messages", () => {
    const client = new ActivityFeedClient("ws://localhost/test");
    const handler = vi.fn();
    client.on(handler);
    client.connect();

    expect(() => {
      lastWsInstance!._triggerMessage("{not valid json}}}");
    }).not.toThrow();

    expect(handler).not.toHaveBeenCalled();

    client.disconnect();
  });
});
