// Copyright GraphCaster. All Rights Reserved.

import { ListenerBag } from "./Transport";
import type { CloseReason, Transport, TransportConfig, TransportEventName, TransportEvents } from "./Transport";

type UnlistenFn = () => void;
type ListenFn = <T>(event: string, cb: (e: { payload: T }) => void) => Promise<UnlistenFn>;

/**
 * Tauri-event-backed Transport. Subscribes to 'gc-run-event' for run lines
 * and 'gc-run-exit' for terminal exit. Errors from the event bus surface
 * via 'error'.
 *
 * Full bridge semantics (stderr prefix, runSessionStore wiring, launchGcStartJob
 * chaining) stay in useRunBridge.ts until the migration PR lands.
 */
export class TauriTransport implements Transport {
  private unlistenEv: UnlistenFn | null = null;
  private unlistenEx: UnlistenFn | null = null;
  private cancelled = false;
  private readonly bag = new ListenerBag();

  open(config: TransportConfig): void {
    this.cancelled = false;
    void (async () => {
      try {
        const mod = (await import("@tauri-apps/api/event")) as { listen: ListenFn };
        const listen = mod.listen;
        const unEv = await listen<{ runId?: string; line?: string; stream?: string }>(
          "gc-run-event",
          (e) => {
            const p = e.payload;
            if (typeof p.runId !== "string" || typeof p.line !== "string") return;
            if (p.runId !== config.runId) return;
            this.bag.emit("line", p.line);
          },
        );
        const unEx = await listen<{ runId?: string; code?: number }>(
          "gc-run-exit",
          (e) => {
            const p = e.payload;
            if (typeof p.runId !== "string") return;
            if (p.runId !== config.runId) return;
            const code = typeof p.code === "number" ? p.code : null;
            this.bag.emit("exit", code);
            this.bag.emit("close", "exit" satisfies CloseReason);
          },
        );
        if (this.cancelled) {
          unEv();
          unEx();
          return;
        }
        this.unlistenEv = unEv;
        this.unlistenEx = unEx;
      } catch (err) {
        this.bag.emit("error", err);
      }
    })();
  }

  close(): void {
    this.cancelled = true;
    this.unlistenEv?.();
    this.unlistenEx?.();
    this.unlistenEv = null;
    this.unlistenEx = null;
    this.bag.emit("close", "user" satisfies CloseReason);
  }

  on<E extends TransportEventName>(event: E, cb: (data: TransportEvents[E]) => void): () => void {
    return this.bag.on(event, cb);
  }
}
