// Copyright GraphCaster. All Rights Reserved.

export const WORKERS_STORAGE_KEY = "gc.workers";
export const WORKERS_API_URL = "/api/v1/workers";

export const ONLINE_THRESHOLD_MS = 30_000;
export const STALE_THRESHOLD_MS = 120_000;

export type WorkerStatus = "online" | "stale" | "offline";

export type WorkerRow = {
  id: string;
  host: string;
  lastHeartbeat: string;
  runningRuns: number;
  version: string;
};

export function computeStatus(lastHeartbeatIso: string, now: number = Date.now()): WorkerStatus {
  const ts = Date.parse(lastHeartbeatIso);
  if (!Number.isFinite(ts)) return "offline";
  const age = now - ts;
  if (age < ONLINE_THRESHOLD_MS) return "online";
  if (age < STALE_THRESHOLD_MS) return "stale";
  return "offline";
}

export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "—";
  const diffMs = Math.max(0, now - ts);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function isWorkerRow(x: unknown): x is WorkerRow {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.host === "string" &&
    typeof o.lastHeartbeat === "string" &&
    typeof o.runningRuns === "number" &&
    typeof o.version === "string"
  );
}

export function loadWorkersFromStorage(): WorkerRow[] {
  const s = safeStorage();
  if (!s) return getSampleWorkers();
  try {
    const raw = s.getItem(WORKERS_STORAGE_KEY);
    if (!raw) return getSampleWorkers();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(isWorkerRow);
    }
    return getSampleWorkers();
  } catch {
    return getSampleWorkers();
  }
}

export function getSampleWorkers(now: number = Date.now()): WorkerRow[] {
  return [
    {
      id: "wkr_01HF8X9ZBQTM7N0K1QY3RAA1AA",
      host: "runner-01.local",
      lastHeartbeat: new Date(now - 5_000).toISOString(),
      runningRuns: 2,
      version: "0.1.0",
    },
    {
      id: "wkr_01HF8X9ZBQTM7N0K1QY3RAA1BB",
      host: "runner-02.local",
      lastHeartbeat: new Date(now - 60_000).toISOString(),
      runningRuns: 0,
      version: "0.1.0",
    },
    {
      id: "wkr_01HF8X9ZBQTM7N0K1QY3RAA1CC",
      host: "runner-03.local",
      lastHeartbeat: new Date(now - 300_000).toISOString(),
      runningRuns: 0,
      version: "0.0.9",
    },
  ];
}

export async function fetchWorkers(signal?: AbortSignal): Promise<WorkerRow[]> {
  try {
    const res = await fetch(WORKERS_API_URL, { signal });
    if (!res.ok) {
      throw new Error(`workers fetch ${res.status}`);
    }
    const data = (await res.json()) as unknown;
    if (Array.isArray(data)) {
      return data.filter(isWorkerRow);
    }
    if (data && typeof data === "object") {
      const items = (data as { workers?: unknown }).workers;
      if (Array.isArray(items)) return items.filter(isWorkerRow);
    }
    throw new Error("workers payload missing");
  } catch {
    return loadWorkersFromStorage();
  }
}
