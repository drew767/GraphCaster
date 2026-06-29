// Copyright GraphCaster. All Rights Reserved.

import type { CloseReason, Transport, TransportConfig, TransportEventName, TransportEvents } from "./Transport";
import { ListenerBag } from "./Transport";

export type ReconnectOptions = {
  baseMs: number;
  capMs: number;
  maxAttempts: number;
  /** 0..1 — when > 0, sleep is multiplied by (1 + random*jitter). Optional. */
  jitter?: number;
};

/**
 * Decorate a Transport with exponential-backoff reconnect.
 *
 * Reconnect triggers: 'close' with reason "transient" or 'error'. Terminal
 * closes ("exit", "user", "exhausted") pass through untouched. Successful
 * 'line' resets the attempt counter.
 *
 * On `maxAttempts` reached, emits 'close' with reason "exhausted".
 *
 * The wrapper preserves a typed listener API and forwards `send` to the inner
 * transport so consumers don't need to peel off the decoration to write back.
 *
 * For sequence-aware resume, callers can register a `getConfigForReopen`
 * builder (via the second open arg) and update it (e.g. with a fresh
 * `sinceSeq`) before each reopen.
 */
export function withReconnect(inner: Transport, options: ReconnectOptions): Transport & {
  setConfigForReopen?: (cfg: TransportConfig) => void;
} {
  const baseMs = Math.max(1, options.baseMs);
  const capMs = Math.max(baseMs, options.capMs);
  const maxAttempts = Math.max(1, options.maxAttempts);
  const jitter = Math.max(0, Math.min(1, options.jitter ?? 0));

  let attempt = 0;
  let lastConfig: TransportConfig | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let closedByUser = false;

  const bag = new ListenerBag();

  const computeDelay = (n: number): number => {
    const raw = Math.min(baseMs * 2 ** n, capMs);
    if (jitter === 0) return raw;
    return Math.round(raw * (1 + Math.random() * jitter));
  };

  const reopen = (): void => {
    if (closedByUser) return;
    if (pendingTimer != null) return;
    if (attempt >= maxAttempts) {
      bag.emit("close", "exhausted" satisfies CloseReason);
      return;
    }
    const delay = computeDelay(attempt);
    attempt += 1;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      if (lastConfig != null && !closedByUser) {
        inner.open(lastConfig);
      }
    }, delay);
  };

  // Bridge inner events to consumer bag and apply reconnect policy.
  inner.on("line", (data) => {
    attempt = 0;
    bag.emit("line", data);
  });
  inner.on("err", (data) => { bag.emit("err", data); });
  inner.on("exit", (data) => { bag.emit("exit", data); });
  inner.on("error", (data) => {
    bag.emit("error", data);
    // Inner connection raised an error; schedule reopen now in case it does
    // not also emit a follow-up 'close'. reopen() is idempotent (no-op while
    // a timer is pending) so a paired close after this is harmless.
    reopen();
  });
  inner.on("close", (reason) => {
    if (reason === "exit" || reason === "user" || reason === "exhausted") {
      bag.emit("close", reason);
      return;
    }
    // "transient" — schedule reopen
    reopen();
  });

  return {
    open(config: TransportConfig): void {
      closedByUser = false;
      lastConfig = config;
      attempt = 0;
      inner.open(config);
    },
    close(): void {
      closedByUser = true;
      lastConfig = null;
      if (pendingTimer != null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      inner.close();
    },
    send(payload: string): void {
      inner.send?.(payload);
    },
    on<E extends TransportEventName>(event: E, cb: (data: TransportEvents[E]) => void): () => void {
      return bag.on(event, cb);
    },
    /** Update the config used on the NEXT reopen — typically to bump `sinceSeq`. */
    setConfigForReopen(cfg: TransportConfig): void {
      lastConfig = cfg;
    },
  };
}
