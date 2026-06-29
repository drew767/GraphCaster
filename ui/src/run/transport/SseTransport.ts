// Copyright GraphCaster. All Rights Reserved.

import { ListenerBag, appendSinceSeq } from "./Transport";
import type { CloseReason, Transport, TransportConfig, TransportEventName, TransportEvents } from "./Transport";

/**
 * EventSource-backed Transport.
 *
 * - "message" events fan out via 'line'
 * - "err" events fan out via 'err'
 * - "exit" events fan out via 'exit' + emit 'close' with reason "exit"
 * - es.onerror surfaces as 'error' then 'close' with reason "transient"
 *   (withReconnect decides whether to reopen).
 */
export class SseTransport implements Transport {
  private es: EventSource | null = null;
  private readonly bag = new ListenerBag();

  open(config: TransportConfig): void {
    if (this.es != null) {
      try { this.es.close(); } catch { /* ignore */ }
      this.es = null;
    }
    const baseUrl = config.endpoint;
    if (baseUrl == null || baseUrl === "") {
      this.bag.emit("error", new Error("SseTransport: missing endpoint"));
      return;
    }
    const url = appendSinceSeq(baseUrl, config.sinceSeq);
    const es = new EventSource(url);
    this.es = es;

    es.addEventListener("message", (e: MessageEvent<string>) => {
      this.bag.emit("line", e.data);
    });
    es.addEventListener("err", (e: MessageEvent<string>) => {
      let text = e.data;
      try {
        const o = JSON.parse(e.data) as { line?: string };
        if (typeof o.line === "string") {
          text = o.line;
        }
      } catch { /* use raw */ }
      this.bag.emit("err", text);
    });
    es.addEventListener("exit", (e: MessageEvent<string>) => {
      let code: number | null = null;
      try {
        const o = JSON.parse(e.data) as { code?: number };
        if (typeof o.code === "number") code = o.code;
      } catch { /* ignore */ }
      this.bag.emit("exit", code);
      this.bag.emit("close", "exit" satisfies CloseReason);
    });
    es.onerror = (e) => {
      // EventSource silently retries on its own; we surface and close so the
      // withReconnect decorator can apply our policy instead.
      this.bag.emit("error", e);
      try { es.close(); } catch { /* ignore */ }
      this.es = null;
      this.bag.emit("close", "transient" satisfies CloseReason);
    };
  }

  close(): void {
    if (this.es != null) {
      try { this.es.close(); } catch { /* ignore */ }
      this.es = null;
    }
    this.bag.emit("close", "user" satisfies CloseReason);
  }

  on<E extends TransportEventName>(event: E, cb: (data: TransportEvents[E]) => void): () => void {
    return this.bag.on(event, cb);
  }
}
