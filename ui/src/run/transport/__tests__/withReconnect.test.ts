// Copyright GraphCaster. All Rights Reserved.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloseReason, Transport, TransportConfig, TransportEventName, TransportEvents } from "../Transport";
import { ListenerBag } from "../Transport";
import { withReconnect } from "../withReconnect";

function makeStubTransport(): {
  transport: Transport;
  emit: <E extends TransportEventName>(ev: E, data: TransportEvents[E]) => void;
  openCount: () => number;
  closeCount: () => number;
  lastConfig: () => TransportConfig | null;
} {
  const bag = new ListenerBag();
  let openCalls = 0;
  let closeCalls = 0;
  let cfg: TransportConfig | null = null;
  const t: Transport = {
    open(config: TransportConfig): void {
      openCalls += 1;
      cfg = config;
    },
    close(): void {
      closeCalls += 1;
    },
    on<E extends TransportEventName>(event: E, cb: (data: TransportEvents[E]) => void): () => void {
      return bag.on(event, cb);
    },
  };
  return {
    transport: t,
    emit: (ev, data) => bag.emit(ev, data),
    openCount: () => openCalls,
    closeCount: () => closeCalls,
    lastConfig: () => cfg,
  };
}

describe("withReconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reopens after underlying 'error' once baseMs elapses", () => {
    const stub = makeStubTransport();
    const wrapped = withReconnect(stub.transport, { baseMs: 100, capMs: 5_000, maxAttempts: 5 });

    wrapped.open({ runId: "r1" });
    expect(stub.openCount()).toBe(1);

    stub.emit("error", new Error("boom"));
    expect(stub.openCount()).toBe(1); // not yet — timer pending

    vi.advanceTimersByTime(100);
    expect(stub.openCount()).toBe(2);
    expect(stub.lastConfig()?.runId).toBe("r1");
  });

  it("emits 'close' with reason 'exhausted' after maxAttempts reached", () => {
    const stub = makeStubTransport();
    const wrapped = withReconnect(stub.transport, { baseMs: 10, capMs: 1_000, maxAttempts: 3 });
    const closeSpy = vi.fn<(r: CloseReason) => void>();
    wrapped.on("close", closeSpy);

    wrapped.open({ runId: "r2" });
    for (let i = 0; i < 3; i += 1) {
      stub.emit("error", undefined);
      vi.advanceTimersByTime(10_000);
    }
    expect(stub.openCount()).toBe(1 + 3);

    stub.emit("error", undefined);
    expect(closeSpy).toHaveBeenCalledWith("exhausted");
  });

  it("resets attempt counter on successful 'line'", () => {
    const stub = makeStubTransport();
    const wrapped = withReconnect(stub.transport, { baseMs: 50, capMs: 5_000, maxAttempts: 4 });
    const lineSpy = vi.fn<(d: string) => void>();
    wrapped.on("line", lineSpy);

    wrapped.open({ runId: "r3" });

    stub.emit("error", undefined);
    vi.advanceTimersByTime(50);
    stub.emit("error", undefined);
    vi.advanceTimersByTime(100);

    stub.emit("line", "hello");
    expect(lineSpy).toHaveBeenCalledWith("hello");

    stub.emit("error", undefined);
    vi.advanceTimersByTime(49);
    const openBefore = stub.openCount();
    vi.advanceTimersByTime(1);
    expect(stub.openCount()).toBe(openBefore + 1);
  });

  it("passes through terminal close reasons without reconnect", () => {
    const stub = makeStubTransport();
    const wrapped = withReconnect(stub.transport, { baseMs: 10, capMs: 100, maxAttempts: 5 });
    const closeSpy = vi.fn<(r: CloseReason) => void>();
    wrapped.on("close", closeSpy);

    wrapped.open({ runId: "r4" });
    stub.emit("close", "exit");
    vi.advanceTimersByTime(10_000);
    // Should pass exit through; no reconnect attempt.
    expect(stub.openCount()).toBe(1);
    expect(closeSpy).toHaveBeenCalledWith("exit");
  });
});
