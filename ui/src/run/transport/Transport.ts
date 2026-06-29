// Copyright GraphCaster. All Rights Reserved.

/**
 * Transport for streaming NDJSON run events from the runtime to the UI.
 *
 * Three concrete impls: SseTransport (web SSE), WsTransport (web WebSocket),
 * TauriTransport (desktop, behind isTauriRuntime() feature detection).
 *
 * MAY:
 * - Translate one underlying connection into typed events for the caller.
 * - Be wrapped by withReconnect() for exponential-backoff reconnect.
 *
 * MUST NOT:
 * - Know about runSessionStore directly (events flow out via callbacks).
 * - Contain reconnect logic (decorated externally).
 * - Mutate global state.
 */

/** Reason supplied to a "close" event by either the underlying transport or withReconnect. */
export type CloseReason = "user" | "exit" | "exhausted" | "transient";

export type TransportConfig = {
  runId: string;
  endpoint?: string;
  authToken?: string;
  /** Last seq seen by the consumer; transport appends `since_seq=N` to the URL when reconnecting. */
  sinceSeq?: number | null;
};

export type TransportEvents = {
  /** Normal NDJSON line from the broker out-channel. */
  line: string;
  /** Stderr / error channel line from the broker (already user-presentable). */
  err: string;
  /** Terminal exit code from the worker. */
  exit: number | null;
  /** Connection lifecycle (recoverable) error. */
  error: unknown;
  /** Connection closed (with reason). */
  close: CloseReason;
};

export type TransportEventName = keyof TransportEvents;

export interface Transport {
  open(config: TransportConfig): void;
  close(): void;
  send?(payload: string): void;
  on<E extends TransportEventName>(event: E, cb: (data: TransportEvents[E]) => void): () => void;
}

export type TransportKind = "sse" | "ws" | "tauri";

/**
 * Build the appropriate transport for the current runtime.
 * Caller is responsible for wrapping with withReconnect() if needed.
 */
export function createTransport(kind: TransportKind): Transport {
  if (kind === "sse") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SseTransport } = require("./SseTransport");
    return new SseTransport();
  }
  if (kind === "ws") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WsTransport } = require("./WsTransport");
    return new WsTransport();
  }
  if (kind === "tauri") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TauriTransport } = require("./TauriTransport");
    return new TauriTransport();
  }
  throw new Error(`Unknown transport kind: ${kind as string}`);
}

/** Build a URL with optional `since_seq=N` query param appended. */
export function appendSinceSeq(url: string, sinceSeq?: number | null): string {
  if (sinceSeq == null || !Number.isFinite(sinceSeq) || sinceSeq < 0) {
    return url;
  }
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}since_seq=${encodeURIComponent(String(sinceSeq))}`;
}

/**
 * Tiny typed listener-bag used by every concrete transport (so we don't repeat
 * the boilerplate 4 times).
 */
export class ListenerBag {
  private readonly bag: Record<TransportEventName, Set<(data: unknown) => void>> = {
    line: new Set(),
    err: new Set(),
    exit: new Set(),
    error: new Set(),
    close: new Set(),
  };

  on<E extends TransportEventName>(event: E, cb: (data: TransportEvents[E]) => void): () => void {
    this.bag[event].add(cb as (d: unknown) => void);
    return () => { this.bag[event].delete(cb as (d: unknown) => void); };
  }

  emit<E extends TransportEventName>(event: E, data: TransportEvents[E]): void {
    for (const cb of this.bag[event]) cb(data);
  }

  clear(): void {
    for (const k of Object.keys(this.bag) as TransportEventName[]) this.bag[k].clear();
  }
}
