// Copyright GraphCaster. All Rights Reserved.

import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { launchGcStartJob } from "./runCommands";
import { applyRunnerNdjsonSideEffects } from "./runEventSideEffects";
import { parseRunEventLine } from "./parseRunEventLine";
import * as store from "./runSessionStore";
import { isTauriRuntime } from "./tauriEnv";
import { closeWebRunBrokerStream } from "./webRunBroker";

export function useRunBridge(): void {
  useEffect(() => {
    if (!isTauriRuntime()) {
      return () => {
        closeWebRunBrokerStream();
      };
    }
    let unlistenEv: (() => void) | undefined;
    let unlistenEx: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      unlistenEv = await listen<{
        runId?: string;
        line?: string;
        stream?: string;
      }>("gc-run-event", (e) => {
        const p = e.payload;
        if (typeof p.runId !== "string" || typeof p.line !== "string") {
          return;
        }
        let prefix = "";
        if (p.stream === "stderr") {
          const ev = parseRunEventLine(p.line);
          const t =
            ev != null && typeof ev === "object" && !Array.isArray(ev)
              ? (ev as { type?: unknown }).type
              : null;
          if (t !== "process_output") {
            prefix = "[stderr] ";
          }
        }
        store.runSessionAppendLineForRun(p.runId, `${prefix}${p.line}`);
        if (p.stream !== "stderr") {
          applyRunnerNdjsonSideEffects(p.line, p.runId);
        }
      });
      unlistenEx = await listen<{ runId?: string; code?: number }>("gc-run-exit", (e) => {
        const p = e.payload;
        if (typeof p.runId !== "string") {
          return;
        }
        const code = typeof p.code === "number" ? p.code : null;
        const next = store.runSessionOnRunProcessExited(p.runId, code);
        if (next != null) {
          void launchGcStartJob(next).catch(() => {
            /* host lines in launchGcStartJob */
          });
        }
      });
      if (cancelled) {
        unlistenEv?.();
        unlistenEx?.();
      }
    })();
    return () => {
      cancelled = true;
      unlistenEv?.();
      unlistenEx?.();
    };
  }, []);
}
