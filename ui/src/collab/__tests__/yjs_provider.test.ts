// Copyright GraphCaster. All Rights Reserved.

import * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CollabProvider } from "../yjs_provider";

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  readyState: number = MockWebSocket.OPEN;
  binaryType: string = "arraybuffer";

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;

  sent: string[] = [];

  constructor(public url: string) {
    _instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(data: string): void {
    this.onmessage?.({ data });
  }
}

const _instances: MockWebSocket[] = [];

function _b64(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

beforeEach(() => {
  _instances.length = 0;
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CollabProvider", () => {
  describe("connect / handshake", () => {
    it("sends hello on WS open", () => {
      const p = new CollabProvider("g1", { wsUrl: "ws://localhost/collab", sessionToken: "tok" });
      const ws = _instances[0];
      ws.simulateOpen();
      expect(ws.sent.length).toBeGreaterThan(0);
      const hello = JSON.parse(ws.sent[0]);
      expect(hello.type).toBe("hello");
      expect(hello.graphId).toBe("g1");
      expect(hello.token).toBe("tok");
      p.disconnect();
    });

    it("emits connected on sync-snapshot", () => {
      const p = new CollabProvider("g1", { wsUrl: "ws://localhost/collab", sessionToken: "" });
      const ws = _instances[0];
      ws.simulateOpen();
      const connectedCb = vi.fn();
      p.on("connected", connectedCb);
      ws.simulateMessage(JSON.stringify({ type: "sync-snapshot", data: "" }));
      expect(connectedCb).toHaveBeenCalledOnce();
      p.disconnect();
    });

    it("applies sync-snapshot Y.Doc update", () => {
      const srcDoc = new Y.Doc();
      srcDoc.getMap("nodes").set("n1", { id: "n1" });
      const update = Y.encodeStateAsUpdate(srcDoc);

      const p = new CollabProvider("g1", { wsUrl: "ws://localhost/collab", sessionToken: "" });
      const ws = _instances[0];
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: "sync-snapshot", data: _b64(update) }));
      expect(p.doc.getMap("nodes").get("n1")).toEqual({ id: "n1" });
      p.disconnect();
    });
  });

  describe("two providers via mock relay", () => {
    it("edit on provider A reflected on provider B", () => {
      const pA = new CollabProvider("shared", {
        wsUrl: "ws://localhost/collab",
        sessionToken: "",
      });
      const wsA = _instances[0];
      wsA.simulateOpen();
      wsA.simulateMessage(JSON.stringify({ type: "sync-snapshot", data: "" }));

      const pB = new CollabProvider("shared", {
        wsUrl: "ws://localhost/collab",
        sessionToken: "",
      });
      const wsB = _instances[1];
      wsB.simulateOpen();
      wsB.simulateMessage(JSON.stringify({ type: "sync-snapshot", data: "" }));

      pA.doc.getMap("nodes").set("nodeA", { id: "nodeA", type: "llm" });

      const outgoing = wsA.sent.find((s) => {
        const m = JSON.parse(s);
        return m.type === "update";
      });
      expect(outgoing).toBeDefined();
      const relayMsg = JSON.parse(outgoing!);

      wsB.simulateMessage(JSON.stringify({ type: "update", data: relayMsg.data }));

      expect(pB.doc.getMap("nodes").get("nodeA")).toMatchObject({ id: "nodeA" });

      pA.disconnect();
      pB.disconnect();
    });
  });

  describe("awareness", () => {
    it("cursor updates are sent on setLocalAwareness", () => {
      const p = new CollabProvider("aw", { wsUrl: "ws://localhost/collab", sessionToken: "" });
      const ws = _instances[0];
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: "sync-snapshot", data: "" }));

      const before = ws.sent.length;
      p.setLocalAwareness({ userId: "u1", name: "Alice", color: "#f00", cursor: { x: 10, y: 20 } });
      const after = ws.sent.length;
      expect(after).toBeGreaterThan(before);
      const msg = JSON.parse(ws.sent[after - 1]);
      expect(msg.type).toBe("awareness");
      p.disconnect();
    });

    it("incoming awareness updates fire awareness listener", () => {
      const p = new CollabProvider("aw2", { wsUrl: "ws://localhost/collab", sessionToken: "" });
      const ws = _instances[0];
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: "sync-snapshot", data: "" }));

      const cb = vi.fn();
      p.on("awareness", cb);

      const fakeState = [{ clientId: 9999, state: { userId: "u2", name: "Bob", color: "#0f0" } }];
      const encoded = btoa(JSON.stringify(fakeState));
      ws.simulateMessage(JSON.stringify({ type: "awareness", data: encoded }));

      expect(cb).toHaveBeenCalledOnce();
      expect(p.awareness.states.get(9999)).toMatchObject({ userId: "u2" });
      p.disconnect();
    });
  });

  describe("disconnect / reconnect", () => {
    it("disconnect prevents reconnect", () => {
      vi.useFakeTimers();
      const p = new CollabProvider("g2", { wsUrl: "ws://localhost/collab", sessionToken: "" });
      const ws = _instances[0];
      ws.simulateOpen();
      p.disconnect();
      ws.close();
      vi.advanceTimersByTime(5000);
      expect(_instances.length).toBe(1);
      vi.useRealTimers();
    });

    it("reconnects after unexpected close", () => {
      vi.useFakeTimers();
      const p = new CollabProvider("g3", { wsUrl: "ws://localhost/collab", sessionToken: "" });
      const ws = _instances[0];
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: "sync-snapshot", data: "" }));

      ws.readyState = MockWebSocket.CLOSED;
      ws.onclose?.();

      vi.advanceTimersByTime(2000);
      expect(_instances.length).toBe(2);

      p.disconnect();
      vi.useRealTimers();
    });
  });
});
