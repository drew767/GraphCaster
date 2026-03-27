// Copyright GraphCaster. All Rights Reserved.

import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { parseRunEventLine } from "./parseRunEventLine";
import * as store from "./runSessionStore";
import { isTauriRuntime } from "./tauriEnv";

export function useRunBridge(): void {
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
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
        if (p.runId !== store.getRunSessionSnapshot().activeRunId) {
          return;
        }
        const prefix = p.stream === "stderr" ? "[stderr] " : "";
        store.runSessionAppendLine(`${prefix}${p.line}`);
        const ev = parseRunEventLine(p.line);
        if (!ev || typeof ev !== "object" || ev === null) {
          return;
        }
        const o = ev as Record<string, unknown>;
        const t = o.type;
        if (t === "node_enter" || t === "node_execute") {
          const nid = o.nodeId;
          if (typeof nid === "string") {
            store.runSessionSetActiveNodeId(nid);
          }
        }
        if (t === "run_finished" || t === "run_end") {
          store.runSessionSetActiveNodeId(null);
        }
      });
      unlistenEx = await listen<{ runId?: string; code?: number }>("gc-run-exit", (e) => {
        const p = e.payload;
        if (typeof p.runId !== "string") {
          return;
        }
        if (p.runId !== store.getRunSessionSnapshot().activeRunId) {
          return;
        }
        store.runSessionSetLastExitCode(typeof p.code === "number" ? p.code : null);
        store.runSessionSetActiveRunId(null);
        store.runSessionSetActiveNodeId(null);
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
