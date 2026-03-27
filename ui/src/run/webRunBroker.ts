// Copyright GraphCaster. All Rights Reserved.

import { applyRunnerNdjsonSideEffects } from "./runEventSideEffects";
import * as store from "./runSessionStore";

const DEFAULT_PREFIX = "/gc-run-broker";

export function getRunBrokerBasePath(): string {
  const raw = import.meta.env.VITE_GC_RUN_BROKER_PREFIX as string | undefined;
  const s = (raw != null && String(raw).trim() !== "" ? String(raw) : DEFAULT_PREFIX).replace(/\/$/, "");
  return s;
}

export function runBrokerStreamRelativeStreamPath(runId: string): string {
  const base = getRunBrokerBasePath();
  const path = `${base}/runs/${encodeURIComponent(runId)}/stream`;
  const token = import.meta.env.VITE_GC_RUN_BROKER_TOKEN as string | undefined;
  const t = token != null ? String(token).trim() : "";
  if (t !== "") {
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}token=${encodeURIComponent(t)}`;
  }
  return path;
}

const brokerStreams = new Map<string, EventSource>();

export function closeWebRunBrokerStream(): void {
  for (const es of brokerStreams.values()) {
    es.close();
  }
  brokerStreams.clear();
}

export function closeWebRunBrokerStreamForRun(runId: string): void {
  const es = brokerStreams.get(runId);
  if (es != null) {
    es.close();
    brokerStreams.delete(runId);
  }
}

export async function probeRunBrokerHealth(): Promise<boolean> {
  const base = getRunBrokerBasePath();
  const token = import.meta.env.VITE_GC_RUN_BROKER_TOKEN as string | undefined;
  const t = token != null ? String(token).trim() : "";
  let url = `${base}/health`;
  if (t !== "") {
    const sep = url.includes("?") ? "&" : "?";
    url += `${sep}token=${encodeURIComponent(t)}`;
  }
  try {
    const r = await fetch(url, { method: "GET" });
    return r.ok;
  } catch {
    return false;
  }
}

function brokerHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const token = import.meta.env.VITE_GC_RUN_BROKER_TOKEN as string | undefined;
  if (token != null && String(token).trim() !== "") {
    h["X-GC-Dev-Token"] = String(token).trim();
  }
  return h;
}

export async function startWebBrokerRun(args: {
  documentJson: string;
  runId: string;
  graphsDir?: string;
  artifactsBase?: string;
  untilNodeId?: string;
  contextJsonPath?: string;
  stepCache?: boolean;
  stepCacheDirty?: string;
}): Promise<void> {
  const base = getRunBrokerBasePath();
  const dirty =
    args.stepCacheDirty == null || args.stepCacheDirty === "" ? null : args.stepCacheDirty;
  const body = {
    documentJson: args.documentJson,
    runId: args.runId,
    graphsDir: args.graphsDir == null || args.graphsDir === "" ? null : args.graphsDir,
    artifactsBase:
      args.artifactsBase == null || args.artifactsBase === "" ? null : args.artifactsBase,
    untilNodeId: args.untilNodeId == null || args.untilNodeId === "" ? null : args.untilNodeId,
    contextJsonPath:
      args.contextJsonPath == null || args.contextJsonPath === "" ? null : args.contextJsonPath,
    stepCache: args.stepCache === true ? true : null,
    stepCacheDirty: dirty,
  };
  const r = await fetch(`${base}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...brokerHeaders() },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || `HTTP ${r.status}`);
  }
  const j = (await r.json()) as { runId?: string };
  const rid = typeof j.runId === "string" ? j.runId : args.runId;

  const existing = brokerStreams.get(rid);
  if (existing != null) {
    existing.close();
    brokerStreams.delete(rid);
  }

  let exitReceived = false;
  const es = new EventSource(runBrokerStreamRelativeStreamPath(rid));
  brokerStreams.set(rid, es);

  es.addEventListener("message", (e: MessageEvent<string>) => {
    const line = e.data;
    store.runSessionAppendLineForRun(rid, line);
    applyRunnerNdjsonSideEffects(line, rid);
  });

  es.addEventListener("err", (e: MessageEvent<string>) => {
    let text = e.data;
    try {
      const o = JSON.parse(e.data) as { line?: string };
      if (typeof o.line === "string") {
        text = o.line;
      }
    } catch {
      /* use raw */
    }
    store.runSessionAppendLineForRun(rid, `[stderr] ${text}`);
  });

  es.addEventListener("exit", (e: MessageEvent<string>) => {
    exitReceived = true;
    let code: number | null = null;
    try {
      const o = JSON.parse(e.data) as { code?: number };
      if (typeof o.code === "number") {
        code = o.code;
      }
    } catch {
      /* ignore */
    }
    closeWebRunBrokerStreamForRun(rid);
    void import("./runCommands").then(({ launchGcStartJob }) => {
      const next = store.runSessionOnRunProcessExited(rid, code);
      if (next != null) {
        void launchGcStartJob(next).catch(() => {
          /* host lines in launchGcStartJob */
        });
      }
    });
  });

  es.onerror = () => {
    if (!brokerStreams.has(rid)) {
      return;
    }
    closeWebRunBrokerStreamForRun(rid);
    if (exitReceived) {
      return;
    }
    exitReceived = true;
    void import("./runCommands").then(({ launchGcStartJob }) => {
      const next = store.runSessionOnRunProcessExited(rid, null);
      if (next != null) {
        void launchGcStartJob(next).catch(() => {});
      }
    });
  };
}

export async function cancelWebBrokerRun(runId: string): Promise<void> {
  const base = getRunBrokerBasePath();
  await fetch(`${base}/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
    headers: brokerHeaders(),
  });
  closeWebRunBrokerStreamForRun(runId);
}

export type WebPersistedRunListItem = {
  runDirName: string;
  hasEvents: boolean;
  hasSummary: boolean;
};

export async function fetchPersistedRunList(
  artifactsBase: string,
  graphId: string,
): Promise<WebPersistedRunListItem[]> {
  const base = getRunBrokerBasePath();
  const r = await fetch(`${base}/persisted-runs/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...brokerHeaders() },
    body: JSON.stringify({ artifactsBase, graphId }),
  });
  if (!r.ok) {
    throw new Error((await r.text()) || `HTTP ${r.status}`);
  }
  const j = (await r.json()) as { items?: WebPersistedRunListItem[] };
  return Array.isArray(j.items) ? j.items : [];
}

export async function fetchPersistedRunEvents(
  artifactsBase: string,
  graphId: string,
  runDirName: string,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const base = getRunBrokerBasePath();
  const r = await fetch(`${base}/persisted-runs/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...brokerHeaders() },
    body: JSON.stringify({ artifactsBase, graphId, runDirName, maxBytes }),
  });
  if (!r.ok) {
    throw new Error((await r.text()) || `HTTP ${r.status}`);
  }
  const j = (await r.json()) as { text?: string; truncated?: boolean };
  const text = typeof j.text === "string" ? j.text : "";
  const truncated = j.truncated === true;
  return { text, truncated };
}

export async function fetchPersistedRunSummary(
  artifactsBase: string,
  graphId: string,
  runDirName: string,
): Promise<string | null> {
  const base = getRunBrokerBasePath();
  const r = await fetch(`${base}/persisted-runs/summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...brokerHeaders() },
    body: JSON.stringify({ artifactsBase, graphId, runDirName }),
  });
  if (!r.ok) {
    throw new Error((await r.text()) || `HTTP ${r.status}`);
  }
  const j = (await r.json()) as { text?: string | null };
  if (j.text == null) {
    return null;
  }
  return typeof j.text === "string" ? j.text : null;
}
