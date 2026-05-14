// Copyright GraphCaster. All Rights Reserved.

export type TelemetryEvent =
  | { type: "workflow.opened"; workflowId: string }
  | { type: "workflow.saved"; workflowId: string; nodeCount: number }
  | { type: "workflow.executed"; workflowId: string; trigger: "manual" | "webhook" | "schedule" }
  | { type: "node.added"; nodeType: string }
  | { type: "node.deleted"; nodeType: string }
  | { type: "ndv.opened"; nodeType: string }
  | { type: "credential.created"; credentialType: string }
  | { type: "page.viewed"; route: string };

const STORAGE_KEY = "gc.telemetry.enabled";
const RING_BUFFER_SIZE = 200;

type StampedEvent = TelemetryEvent & { _ts: number };

const ringBuffer: StampedEvent[] = [];

function safeStorage(): Storage | null {
  try {
    if (typeof globalThis !== "undefined" && typeof globalThis.localStorage !== "undefined") {
      return globalThis.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export function isTelemetryEnabled(): boolean {
  const ls = safeStorage();
  if (ls === null) {
    return false;
  }
  try {
    return ls.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function enableTelemetry(): void {
  const ls = safeStorage();
  if (ls === null) {
    return;
  }
  try {
    ls.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function disableTelemetry(): void {
  const ls = safeStorage();
  if (ls === null) {
    return;
  }
  try {
    ls.setItem(STORAGE_KEY, "0");
  } catch {
    /* ignore */
  }
}

export function track(event: TelemetryEvent): void {
  if (!isTelemetryEnabled()) {
    return;
  }
  const stamped: StampedEvent = { ...event, _ts: Date.now() };
  ringBuffer.push(stamped);
  if (ringBuffer.length > RING_BUFFER_SIZE) {
    ringBuffer.splice(0, ringBuffer.length - RING_BUFFER_SIZE);
  }
}

export function getRecentEvents(): ReadonlyArray<TelemetryEvent> {
  return ringBuffer.map((e) => {
    const { _ts: _ignored, ...rest } = e;
    void _ignored;
    return rest as TelemetryEvent;
  });
}

export function _resetTelemetryForTests(): void {
  ringBuffer.length = 0;
  const ls = safeStorage();
  if (ls !== null) {
    try {
      ls.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}
