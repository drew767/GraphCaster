// Copyright GraphCaster. All Rights Reserved.

import i18n from "../i18n";
import { createNdjsonSeqReorderSink, type NdjsonSeqReorderSink } from "./ndjsonSeqReorder";
import { applyRunnerNdjsonSideEffects } from "./runEventSideEffects";
import * as store from "./runSessionStore";
import { dispatchBrokerWebSocketJson } from "./webRunBrokerDispatch";

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
const brokerSockets = new Map<string, WebSocket>();

const ndjsonSeqSinksByRun = new Map<string, NdjsonSeqReorderSink>();

/** When set, transient WS close must not reconnect (user cancel / stream replacement). */
const wsReconnectSuppressed = new Set<string>();

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

function releaseNdjsonSeqSink(rid: string): void {
  const s = ndjsonSeqSinksByRun.get(rid);
  if (s != null) {
    s.reset();
    ndjsonSeqSinksByRun.delete(rid);
  }
}

const MAX_SSE_RECONNECT_ATTEMPTS = 12;
const MAX_WS_RECONNECT_ATTEMPTS = 12;
const SSE_BACKOFF_BASE_MS = 400;
const SSE_BACKOFF_CAP_MS = 25_000;
const WS_BACKOFF_BASE_MS = 400;
const WS_BACKOFF_CAP_MS = 25_000;

function sseReconnectDelayMs(attempt: number): number {
  return Math.min(SSE_BACKOFF_CAP_MS, SSE_BACKOFF_BASE_MS * 2 ** attempt);
}

function wsReconnectDelayMs(attempt: number): number {
  return Math.min(WS_BACKOFF_CAP_MS, WS_BACKOFF_BASE_MS * 2 ** attempt);
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

function attachWebBrokerSseRunStream(
  rid: string,
  attempt: number,
  state: { exitReceived: boolean },
): void {
  const es = new EventSource(runBrokerStreamRelativeStreamPath(rid));
  brokerStreams.set(rid, es);

  es.addEventListener("message", (e: MessageEvent<string>) => {
    const line = e.data;
    ndjsonSeqSinkForRun(rid).accept(line);
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
    state.exitReceived = true;
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
    scheduleLaunchAfterRunExit(rid, code);
  });

  es.onerror = () => {
    if (!brokerStreams.has(rid)) {
      return;
    }
    if (brokerStreams.get(rid) !== es) {
      return;
    }
    es.close();
    brokerStreams.delete(rid);
    if (state.exitReceived) {
      return;
    }
    if (attempt >= MAX_SSE_RECONNECT_ATTEMPTS) {
      state.exitReceived = true;
      store.runSessionAppendLineForRun(
        rid,
        "[host] Run stream: reconnect attempts exhausted (SSE). Treating run as finished.",
      );
      scheduleLaunchAfterRunExit(rid, null);
      return;
    }
    window.setTimeout(() => {
      attachWebBrokerSseRunStream(rid, attempt + 1, state);
    }, sseReconnectDelayMs(attempt));
  };
}

function attachWebBrokerWebSocket(
  rid: string,
  viewerToken: string,
  attempt: number,
  state: { exitReceived: boolean },
): void {
  const url = runBrokerWebSocketUrl(rid, viewerToken);
  const ws = new WebSocket(url);
  brokerSockets.set(rid, ws);

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
        try {
          ws.send(JSON.stringify({ type: "pong", runId: rid }));
        } catch {
          /* ignore */
        }
        return;
      }
    }
    dispatchBrokerWebSocketJson(rid, parsed, {
      appendLine: (line) => {
        ndjsonSeqSinkForRun(rid).accept(line);
      },
      applyNdjson: (_line, _runId) => {
        /* NDJSON side effects run in seq sink flush */
      },
      onExit: (code) => {
        state.exitReceived = true;
        closeWebRunBrokerStreamForRun(rid);
        scheduleLaunchAfterRunExit(rid, code);
      },
    });
  };

  const scheduleReconnect = (): void => {
    if (wsReconnectSuppressed.has(rid)) {
      return;
    }
    if (state.exitReceived) {
      return;
    }
    if (attempt >= MAX_WS_RECONNECT_ATTEMPTS) {
      state.exitReceived = true;
      store.runSessionAppendLineForRun(
        rid,
        "[host] Run stream: reconnect attempts exhausted (WebSocket). Treating run as finished.",
      );
      scheduleLaunchAfterRunExit(rid, null);
      return;
    }
    window.setTimeout(() => {
      attachWebBrokerWebSocket(rid, viewerToken, attempt + 1, state);
    }, wsReconnectDelayMs(attempt));
  };

  ws.onerror = () => {
    if (!brokerSockets.has(rid)) {
      return;
    }
    brokerSockets.delete(rid);
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    scheduleReconnect();
  };

  ws.onclose = () => {
    if (brokerSockets.get(rid) === ws) {
      brokerSockets.delete(rid);
    }
    if (state.exitReceived) {
      return;
    }
    scheduleReconnect();
  };
}

export function closeWebRunBrokerStream(): void {
  for (const es of brokerStreams.values()) {
    es.close();
  }
  brokerStreams.clear();
  for (const w of brokerSockets.values()) {
    try {
      w.close();
    } catch {
      /* ignore */
    }
  }
  brokerSockets.clear();
  ndjsonSeqSinksByRun.clear();
  wsReconnectSuppressed.clear();
}

export function closeWebRunBrokerStreamForRun(runId: string): void {
  const rid = runId.trim();
  if (rid !== "") {
    wsReconnectSuppressed.add(rid);
  }
  const es = brokerStreams.get(runId);
  if (es != null) {
    es.close();
    brokerStreams.delete(runId);
  }
  const w = brokerSockets.get(runId);
  if (w != null) {
    try {
      w.close();
    } catch {
      /* ignore */
    }
    brokerSockets.delete(runId);
  }
  releaseNdjsonSeqSink(runId);
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
  wsReconnectSuppressed.delete(rid.trim());

  if (runTransportIsWebSocket()) {
    if (viewerToken === "") {
      throw new Error("broker response missing viewerToken");
    }
    const wsState = { exitReceived: false };
    attachWebBrokerWebSocket(rid, viewerToken, 0, wsState);
    return;
  }

  const sseState = { exitReceived: false };
  attachWebBrokerSseRunStream(rid, 0, sseState);
}

export async function cancelWebBrokerRun(runId: string): Promise<void> {
  const w = brokerSockets.get(runId);
  if (w != null && w.readyState === WebSocket.OPEN) {
    try {
      w.send(JSON.stringify({ type: "cancel_run", runId }));
    } catch {
      /* ignore */
    }
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
  if (j.text == null) {
    return null;
  }
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

function catalogStrField(
  o: Record<string, unknown>,
  camel: string,
  snake: string,
): string {
  const a = o[camel];
  if (typeof a === "string" && a.trim() !== "") {
    return a.trim();
  }
  const b = o[snake];
  if (typeof b === "string" && b.trim() !== "") {
    return b.trim();
  }
  return "";
}

function catalogOptionalStr(
  o: Record<string, unknown>,
  camel: string,
  snake: string,
): string | null {
  const s = catalogStrField(o, camel, snake);
  return s === "" ? null : s;
}

/** Normalize broker JSON for run-catalog list (shared with tests). */
export function parseRunCatalogListJson(data: unknown): WebRunCatalogRow[] {
  if (typeof data !== "object" || data === null) {
    return [];
  }
  const raw = data as { items?: unknown };
  if (!Array.isArray(raw.items)) {
    return [];
  }
  const out: WebRunCatalogRow[] = [];
  for (const it of raw.items) {
    if (typeof it !== "object" || it === null) {
      continue;
    }
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
    if (!runId || !rootGraphId || !runDirName || !status || !finishedAt) {
      continue;
    }
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
  if (gid !== "") {
    body.graphId = gid;
  }
  const st = options?.status != null ? String(options.status).trim() : "";
  if (st !== "") {
    body.status = st;
  }
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

/** Decimal count as string (same as CLI stdout); avoids precision loss for huge integers in JSON. */
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
