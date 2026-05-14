// Copyright GraphCaster. All Rights Reserved.

import * as Y from "yjs";

export type CollabEvent = "change" | "awareness" | "connected" | "disconnected";

export interface CollabProviderOptions {
  wsUrl: string;
  sessionToken: string;
}

type EventHandler<E extends CollabEvent> = E extends "connected" | "disconnected"
  ? () => void
  : E extends "change"
    ? (update: Uint8Array) => void
    : E extends "awareness"
      ? (update: Uint8Array) => void
      : never;

interface AwarenessState {
  userId?: string;
  name?: string;
  color?: string;
  cursor?: { x: number; y: number };
  selection?: string[];
}

interface AwarenessStore {
  clientId: number;
  states: Map<number, AwarenessState>;
  localState: AwarenessState;
  listeners: Set<(states: Map<number, AwarenessState>) => void>;
}

function encodeAwarenessUpdate(store: AwarenessStore, clientIds: number[]): Uint8Array {
  const entries: Array<{ clientId: number; state: AwarenessState | null }> = [];
  for (const id of clientIds) {
    const state = id === store.clientId ? store.localState : (store.states.get(id) ?? null);
    entries.push({ clientId: id, state });
  }
  return new TextEncoder().encode(JSON.stringify(entries));
}

function applyAwarenessUpdate(
  store: AwarenessStore,
  update: Uint8Array,
): void {
  try {
    const entries: Array<{ clientId: number; state: AwarenessState | null }> = JSON.parse(
      new TextDecoder().decode(update),
    );
    for (const { clientId, state } of entries) {
      if (clientId === store.clientId) continue;
      if (state === null) {
        store.states.delete(clientId);
      } else {
        store.states.set(clientId, state);
      }
    }
    for (const listener of store.listeners) {
      listener(store.states);
    }
  } catch {
    // malformed — ignore
  }
}

export class CollabProvider {
  readonly doc: Y.Doc;
  readonly graphId: string;
  ws: WebSocket | null = null;

  private readonly wsUrl: string;
  private readonly sessionToken: string;
  private readonly listeners: Map<CollabEvent, Set<(...args: unknown[]) => void>> = new Map();
  private destroyed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;

  readonly awareness: AwarenessStore;

  constructor(graphId: string, { wsUrl, sessionToken }: CollabProviderOptions) {
    this.graphId = graphId;
    this.wsUrl = wsUrl;
    this.sessionToken = sessionToken;
    this.doc = new Y.Doc();
    this.awareness = {
      clientId: this.doc.clientID,
      states: new Map(),
      localState: {},
      listeners: new Set(),
    };
    this.connect();
  }

  connect(): void {
    if (this.destroyed) return;
    this.ws = new WebSocket(this.wsUrl);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.ws!.send(
        JSON.stringify({
          type: "hello",
          graphId: this.graphId,
          token: this.sessionToken,
        }),
      );
    };

    this.ws.onmessage = (event) => {
      let msg: { type: string; data?: string };
      if (typeof event.data === "string") {
        try {
          msg = JSON.parse(event.data) as { type: string; data?: string };
        } catch {
          return;
        }
      } else {
        return;
      }

      if (msg.type === "sync-snapshot") {
        if (msg.data) {
          const bytes = _base64ToUint8(msg.data);
          Y.applyUpdate(this.doc, bytes);
          this._emit("change", bytes);
        }
        this._emit("connected");
      } else if (msg.type === "update" && msg.data) {
        const bytes = _base64ToUint8(msg.data);
        Y.applyUpdate(this.doc, bytes, "remote");
        this._emit("change", bytes);
      } else if (msg.type === "awareness" && msg.data) {
        const bytes = _base64ToUint8(msg.data);
        applyAwarenessUpdate(this.awareness, bytes);
        this._emit("awareness", bytes);
      }
    };

    this.ws.onclose = () => {
      this._emit("disconnected");
      if (!this.destroyed) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
          this.connect();
        }, this.reconnectDelay);
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };

    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "update", data: _uint8ToBase64(update) }));
      }
    });
  }

  disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  setLocalAwareness(state: AwarenessState): void {
    this.awareness.localState = { ...this.awareness.localState, ...state };
    const update = encodeAwarenessUpdate(this.awareness, [this.awareness.clientId]);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "awareness", data: _uint8ToBase64(update) }));
    }
  }

  on<E extends CollabEvent>(event: E, cb: EventHandler<E>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(cb as (...args: unknown[]) => void);
  }

  off<E extends CollabEvent>(event: E, cb: EventHandler<E>): void {
    this.listeners.get(event)?.delete(cb as (...args: unknown[]) => void);
  }

  private _emit(event: "connected" | "disconnected"): void;
  private _emit(event: "change" | "awareness", data: Uint8Array): void;
  private _emit(event: CollabEvent, ...args: unknown[]): void {
    for (const cb of this.listeners.get(event) ?? []) {
      cb(...args);
    }
  }
}

function _base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function _uint8ToBase64(buf: Uint8Array): string {
  let bin = "";
  for (const byte of buf) bin += String.fromCharCode(byte);
  return btoa(bin);
}
