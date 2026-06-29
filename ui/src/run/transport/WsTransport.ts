// Copyright GraphCaster. All Rights Reserved.

import { dispatchBrokerWebSocketJson } from "../webRunBrokerDispatch";
import { ListenerBag, appendSinceSeq } from "./Transport";
import type { CloseReason, Transport, TransportConfig, TransportEventName, TransportEvents } from "./Transport";

/**
 * WebSocket-backed Transport.
 *
 * - JSON envelopes are dispatched via the shared dispatcher; stdout maps to 'line',
 *   stderr maps to 'err' (with the [stderr] prefix already attached), and
 *   exit maps to 'exit' + 'close' with reason "exit".
 * - Ping frames are answered with pong inline (does not surface to consumer).
 * - onclose / onerror emit 'error' (if applicable) then 'close' with reason "transient",
 *   leaving reconnect decisions to withReconnect.
 */
export class WsTransport implements Transport {
  private ws: WebSocket | null = null;
  private runId = "";
  private exitSeen = false;
  private readonly bag = new ListenerBag();

  open(config: TransportConfig): void {
    if (this.ws != null) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.runId = config.runId;
    this.exitSeen = false;
    const baseUrl = config.endpoint;
    if (baseUrl == null || baseUrl === "") {
      this.bag.emit("error", new Error("WsTransport: missing endpoint"));
      return;
    }
    const url = appendSinceSeq(baseUrl, config.sinceSeq);
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onmessage = (ev: MessageEvent<string>) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(ev.data) as unknown;
      } catch {
        return;
      }
      if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
        const m = parsed as Record<string, unknown>;
        if (m.channel === "ping") {
          try { ws.send(JSON.stringify({ type: "pong", runId: this.runId })); } catch { /* ignore */ }
          return;
        }
      }
      dispatchBrokerWebSocketJson(this.runId, parsed, {
        appendLine: (line) => { this.bag.emit("line", line); },
        applyNdjson: () => { /* side effects handled by consumer's seq sink */ },
        onExit: (code) => {
          this.exitSeen = true;
          this.bag.emit("exit", code);
          this.bag.emit("close", "exit" satisfies CloseReason);
        },
      });
    };

    ws.onerror = (e) => {
      this.bag.emit("error", e);
    };

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.exitSeen) return;
      this.bag.emit("close", "transient" satisfies CloseReason);
    };
  }

  close(): void {
    if (this.ws != null) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.bag.emit("close", "user" satisfies CloseReason);
  }

  send(payload: string): void {
    const ws = this.ws;
    if (ws == null || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(payload); } catch { /* ignore */ }
  }

  on<E extends TransportEventName>(event: E, cb: (data: TransportEvents[E]) => void): () => void {
    return this.bag.on(event, cb);
  }
}
