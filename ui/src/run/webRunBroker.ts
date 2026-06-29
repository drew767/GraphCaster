// Copyright GraphCaster. All Rights Reserved.

import i18n from "../i18n";
import { createNdjsonSeqReorderSink, type NdjsonSeqReorderSink } from "./ndjsonSeqReorder";
import { applyRunnerNdjsonSideEffects } from "./runEventSideEffects";
import * as store from "./runSessionStore";
import { SseTransport } from "./transport/SseTransport";
import type { Transport } from "./transport/Transport";
import { WsTransport } from "./transport/WsTransport";
import { withReconnect } from "./transport/withReconnect";

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

export function runBrokerWebSocketUrl(runId: string, viewerToken: string): string {
  const base = getRunBrokerBasePath();
  const path = `${base}/runs/${encodeURIComponent(runId)}/ws`;
  const qp = new URLSearchParams();
  qp.set("viewerToken", viewerToken);
  const token = import.meta.env.VITE_GC_RUN_BROKER_TOKEN as string | undefined;
  const t = token != null ? String(token).trim() : "";
  if (t !== "") {
    qp.set("token", t);
  }
  const loc = window.location;
  const scheme = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${loc.host}${path}?${qp.toString()}`;
}

/** Per-entry stream + creation timestamp; TTL sweep evicts entries older than `MAX_STREAM_LIFETIME_MS`. */
type StreamEntry<T> = { stream: T; createdAt: number };

// Per-run live transports (after Transport refactor). brokerStreams/brokerSockets
// remain only to satisfy the existing TTL sweep test API (which registers
// EventSource / WebSocket directly).
const brokerStreams = new Map<string, StreamEntry<EventSource>>();
const brokerSockets = new Map<string, StreamEntry<WebSocket>>();
const liveTransports = new Map<string, StreamEntry<Transport>>();

const ndjsonSeqSinksByRun = new Map<string, NdjsonSeqReorderSink>();
/** Reset between runs; used to detect server-side seq gaps and surface them to the console. */
const lastSeqByRunId = new Map<string, number>();

export const MAX_STREAM_LIFETIME_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60_000;

const RECONNECT_BASE_MS = 400;
const RECONNECT_CAP_MS = 25_000;
const RECONNECT_MAX_ATTEMPTS = 12;
const RECONNECT_JITTER = 0.2;

let sweepTimerId: ReturnType<typeof setInterval> | null = null;

export function sweepExpiredBrokerStreams(now: number = Date.now()): string[] {
  const evicted: string[] = [];
  for (const [rid, entry] of Array.from(brokerStreams.entries())) {
    if (now - entry.createdAt > MAX_STREAM_LIFETIME_MS) {
      try { entry.stream.close(); } catch { /* ignore */ }
      brokerStreams.delete(rid);
      releaseRunResources(rid);
      evicted.push(rid);
    }
  }
  for (const [rid, entry] of Array.from(brokerSockets.entries())) {
    if (now - entry.createdAt > MAX_STREAM_LIFETIME_MS) {
      try { entry.stream.close(); } catch { /* ignore */ }
      brokerSockets.delete(rid);
      releaseRunResources(rid);
      if (!evicted.includes(rid)) evicted.push(rid);
    }
  }
  for (const [rid, entry] of Array.from(liveTransports.entries())) {
    if (now - entry.createdAt > MAX_STREAM_LIFETIME_MS) {
      try { entry.stream.close(); } catch { /* ignore */ }
      liveTransports.delete(rid);
      releaseRunResources(rid);
      if (!evicted.includes(rid)) evicted.push(rid);
    }
  }
  return evicted;
}

function startSweepTimer(): void {
  if (sweepTimerId != null) return;
  if (typeof setInterval === "undefined") return;
  sweepTimerId = setInterval(() => { sweepExpiredBrokerStreams(); }, SWEEP_INTERVAL_MS);
}

export function __stopSweep(): void {
  if (sweepTimerId != null) {
    clearInterval(sweepTimerId);
    sweepTimerId = null;
  }
}

export function _resetWebRunBrokerForTests(): void {
  for (const entry of brokerStreams.values()) {
    try { entry.stream.close(); } catch { /* ignore */ }
  }
  brokerStreams.clear();
  for (const entry of brokerSockets.values()) {
    try { entry.stream.close(); } catch { /* ignore */ }
  }
  brokerSockets.clear();
  for (const entry of liveTransports.values()) {
    try { entry.stream.close(); } catch { /* ignore */ }
  }
  liveTransports.clear();
  ndjsonSeqSinksByRun.clear();
  lastSeqByRunId.clear();
  __stopSweep();
}

export function __peekLiveRunIdsForTest(): string[] {
  const ids: string[] = [];
  for (const k of brokerStreams.keys()) ids.push(k);
  for (const k of brokerSockets.keys()) if (!ids.includes(k)) ids.push(k);
  for (const k of liveTransports.keys()) if (!ids.includes(k)) ids.push(k);
  return ids;
}

export function __registerEventSourceForTest(runId: string, es: EventSource, createdAt: number): void {
  brokerStreams.set(runId, { stream: es, createdAt });
  startSweepTimer();
}

export function __registerWebSocketForTest(runId: string, ws: WebSocket, createdAt: number): void {
  brokerSockets.set(runId, { stream: ws, createdAt });
  startSweepTimer();
}

function ndjsonSeqSinkForRun(rid: string): NdjsonSeqReorderSink {
  let s = ndjsonSeqSinksByRun.get(rid);
  if (s == null) {
    s = createNdjsonSeqReorderSink((line) => {
      store.runSessionAppendLineForRun(rid, line);
      applyRunnerNdjsonSideEffects(line, rid);
    });
    ndjsonSeqSinksByRun.set(rid, s);
  }
  return s;
}

function releaseRunResources(rid: string): void {
  const s = ndjsonSeqSinksByRun.get(rid);
  if (s != null) {
    s.reset();
    ndjsonSeqSinksByRun.delete(rid);
  }
  lastSeqByRunId.delete(rid);
}

function scheduleLaunchAfterRunExit(rid: string, code: number | null): void {
  void import("./runCommands").then(({ launchGcStartJob }) => {
    const next = store.runSessionOnRunProcessExited(rid, code);
    if (next != null) {
      void launchGcStartJob(next).catch(() => {});
    }
  });
}

function runTransportIsWebSocket(): boolean {
  const v = import.meta.env.VITE_GC_RUN_TRANSPORT;
  return String(v ?? "").trim().toLowerCase() === "ws";
}

/**
 * Detect a sequence gap from a freshly-arrived line and log it to the run console.
 * Lines without `seq` are ignored. Lines with seq <= last seen are also ignored
 * (handled by the seq sink). Only a forward jump > 1 surfaces as a gap warning.
 */
function maybeLogSeqGap(rid: string, line: string): void {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed[0] !== "{") return;
  let seq: unknown;
  try {
    const o = JSON.parse(trimmed) as { seq?: unknown };
    seq = o.seq;
  } catch { return; }
  if (typeof seq !== "number" || !Number.isFinite(seq)) return;
  const cur = lastSeqByRunId.get(rid) ?? 0;
  if (seq > cur + 1 && cur > 0) {
    const lost = seq - cur - 1;
    store.runSessionAppendLineForRun(rid, `[host] event gap: lost ${String(lost)} events`);
  }
  if (seq > cur) lastSeqByRunId.set(rid, seq);
}

function attachTransport(rid: string, viewerToken: string): void {
  const isWs = runTransportIsWebSocket();
  const inner = isWs ? new WsTransport() : new SseTransport();
  const transport = withReconnect(inner, {
    baseMs: RECONNECT_BASE_MS,
    capMs: RECONNECT_CAP_MS,
    maxAttempts: RECONNECT_MAX_ATTEMPTS,
    jitter: RECONNECT_JITTER,
  });
  liveTransports.set(rid, { stream: transport, createdAt: Date.now() });
  startSweepTimer();

  const sink = ndjsonSeqSinkForRun(rid);
  const endpoint = isWs
    ? runBrokerWebSocketUrl(rid, viewerToken)
    : runBrokerStreamRelativeStreamPath(rid);

  transport.on("line", (line) => {
    maybeLogSeqGap(rid, line);
    sink.accept(line);
    // Refresh reopen config so a subsequent transient reconnect resumes from
    // the latest flushed seq instead of the initial null. Cheap idempotent write.
    const lastSeq = sink.lastFlushedSeq();
    transport.setConfigForReopen?.({
      runId: rid,
      endpoint,
      sinceSeq: lastSeq > 0 ? lastSeq : null,
    });
  });
  transport.on("err", (text) => {
    store.runSessionAppendLineForRun(rid, `[stderr] ${text}`);
  });
  transport.on("exit", (code) => {
    closeWebRunBrokerStreamForRun(rid);
    scheduleLaunchAfterRunExit(rid, code);
  });
  transport.on("close", (reason) => {
    if (reason === "exhausted") {
      store.runSessionAppendLineForRun(
        rid,
        isWs
          ? "[host] Run stream: reconnect attempts exhausted (WebSocket). Treating run as finished."
          : "[host] Run stream: reconnect attempts exhausted (SSE). Treating run as finished.",
      );
      scheduleLaunchAfterRunExit(rid, null);
    }
  });

  transport.open({ runId: rid, endpoint, sinceSeq: null });
}

export function closeWebRunBrokerStream(): void {
  for (const entry of brokerStreams.values()) {
    try { entry.stream.close(); } catch { /* ignore */ }
  }
  brokerStreams.clear();
  for (const entry of brokerSockets.values()) {
    try { entry.stream.close(); } catch { /* ignore */ }
  }
  brokerSockets.clear();
  for (const entry of liveTransports.values()) {
    try { entry.stream.close(); } catch { /* ignore */ }
  }
  liveTransports.clear();
  ndjsonSeqSinksByRun.clear();
  lastSeqByRunId.clear();
}

export function closeWebRunBrokerStreamForRun(runId: string): void {
  const esEntry = brokerStreams.get(runId);
  if (esEntry != null) {
    try { esEntry.stream.close(); } catch { /* ignore */ }
    brokerStreams.delete(runId);
  }
  const wEntry = brokerSockets.get(runId);
  if (wEntry != null) {
    try { wEntry.stream.close(); } catch { /* ignore */ }
    brokerSockets.delete(runId);
  }
  const tEntry = liveTransports.get(runId);
  if (tEntry != null) {
    try { tEntry.stream.close(); } catch { /* ignore */ }
    liveTransports.delete(runId);
  }
  releaseRunResources(runId);
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
  let r: Response;
  try {
    r = await fetch(`${base}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...brokerHeaders() },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const off =
      typeof navigator !== "undefined" && navigator.onLine === false
        ? i18n.t("app.errors.network.offlineHint")
        : i18n.t("app.errors.network.brokerHint");
    const baseMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`${baseMsg} — ${off}`);
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || `HTTP ${r.status}`);
  }
  const j = (await r.json()) as {
    runId?: string;
    viewerToken?: string;
    runBroker?: { phase?: string; queuePosition?: number };
  };
  const rid = typeof j.runId === "string" ? j.runId : args.runId;
  const viewerToken = typeof j.viewerToken === "string" ? j.viewerToken : "";
  const rb = j.runBroker;
  if (
    rb?.phase === "queued" &&
    typeof rb.queuePosition === "number" &&
    Number.isFinite(rb.queuePosition)
  ) {
    store.runSessionAppendLineForRun(
      rid,
      i18n.t("app.run.brokerFifoQueued", { position: String(rb.queuePosition) }),
    );
  }

  closeWebRunBrokerStreamForRun(rid);

  if (runTransportIsWebSocket() && viewerToken === "") {
    throw new Error("broker response missing viewerToken");
  }
  attachTransport(rid, viewerToken);
}

export async function cancelWebBrokerRun(runId: string): Promise<void> {
  const wEntry = brokerSockets.get(runId);
  if (wEntry != null && wEntry.stream.readyState === WebSocket.OPEN) {
    try {
      wEntry.stream.send(JSON.stringify({ type: "cancel_run", runId }));
    } catch { /* ignore */ }
  }
  // For new-style transports: send via Transport.send if possible.
  const tEntry = liveTransports.get(runId);
  if (tEntry != null && typeof tEntry.stream.send === "function") {
    try { tEntry.stream.send(JSON.stringify({ type: "cancel_run", runId })); } catch { /* ignore */ }
  }
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
  if (j.text == null) return null;
  return typeof j.text === "string" ? j.text : null;
}

export type WebRunCatalogRow = {
  runId: string;
  rootGraphId: string;
  runDirName: string;
  status: string;
  startedAt: string | null;
  finishedAt: string;
  artifactRelPath: string;
};

function catalogStrField(o: Record<string, unknown>, camel: string, snake: string): string {
  const a = o[camel];
  if (typeof a === "string" && a.trim() !== "") return a.trim();
  const b = o[snake];
  if (typeof b === "string" && b.trim() !== "") return b.trim();
  return "";
}

function catalogOptionalStr(o: Record<string, unknown>, camel: string, snake: string): string | null {
  const s = catalogStrField(o, camel, snake);
  return s === "" ? null : s;
}

export function parseRunCatalogListJson(data: unknown): WebRunCatalogRow[] {
  if (typeof data !== "object" || data === null) return [];
  const raw = data as { items?: unknown };
  if (!Array.isArray(raw.items)) return [];
  const out: WebRunCatalogRow[] = [];
  for (const it of raw.items) {
    if (typeof it !== "object" || it === null) continue;
    const o = it as Record<string, unknown>;
    const runId = catalogStrField(o, "runId", "run_id");
    const rootGraphId = catalogStrField(o, "rootGraphId", "root_graph_id");
    const runDirName =
      typeof o.runDirName === "string"
        ? o.runDirName.trim()
        : typeof o.run_dir_name === "string"
          ? o.run_dir_name.trim()
          : "";
    const status = catalogStrField(o, "status", "status");
    const finishedAt = catalogStrField(o, "finishedAt", "finished_at");
    const artifactRelPath = catalogStrField(o, "artifactRelPath", "artifact_relpath");
    const startedAt = catalogOptionalStr(o, "startedAt", "started_at");
    if (!runId || !rootGraphId || !runDirName || !status || !finishedAt) continue;
    out.push({ runId, rootGraphId, runDirName, status, startedAt, finishedAt, artifactRelPath });
  }
  return out;
}

export async function fetchRunCatalogList(
  artifactsBase: string,
  options?: {
    graphId?: string | null;
    status?: string | null;
    limit?: number;
    offset?: number;
  },
): Promise<WebRunCatalogRow[]> {
  const base = getRunBrokerBasePath();
  const body: Record<string, unknown> = {
    artifactsBase,
    limit: options?.limit ?? 500,
    offset: options?.offset ?? 0,
  };
  const gid = options?.graphId != null ? String(options.graphId).trim() : "";
  if (gid !== "") body.graphId = gid;
  const st = options?.status != null ? String(options.status).trim() : "";
  if (st !== "") body.status = st;
  const r = await fetch(`${base}/run-catalog/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...brokerHeaders() },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error((await r.text()) || `HTTP ${r.status}`);
  }
  return parseRunCatalogListJson(await r.json());
}

export async function fetchRunCatalogRebuild(artifactsBase: string): Promise<string> {
  const base = getRunBrokerBasePath();
  const r = await fetch(`${base}/run-catalog/rebuild`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...brokerHeaders() },
    body: JSON.stringify({ artifactsBase }),
  });
  if (!r.ok) {
    throw new Error((await r.text()) || `HTTP ${r.status}`);
  }
  const j = (await r.json()) as { rebuilt?: unknown };
  if (typeof j.rebuilt === "number" && Number.isFinite(j.rebuilt)) {
    return String(Math.trunc(j.rebuilt));
  }
  if (typeof j.rebuilt === "string" && j.rebuilt.trim() !== "") {
    return j.rebuilt.trim();
  }
  throw new Error("broker: rebuilt count missing");
}
