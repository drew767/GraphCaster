// Copyright GraphCaster. All Rights Reserved.

export type WorkerStatus = "online" | "stale" | "offline";

export interface Worker {
  id: string;
  host: string;
  status?: WorkerStatus;
  lastHeartbeat: string;
  runningRuns: number;
  version: string;
}

const STORAGE_KEY = "gc.workers";

function safeGetStorage(): Storage | null {
  try {
    if (typeof globalThis !== "undefined" && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function readSeed(): Worker[] {
  const now = Date.now();
  return [
    {
      id: "wrk-7f3b1c2d8e",
      host: "worker-1.gc.local",
      lastHeartbeat: new Date(now - 5_000).toISOString(),
      runningRuns: 2,
      version: "0.42.1",
    },
    {
      id: "wrk-a91c4d2f5b",
      host: "worker-2.gc.local",
      lastHeartbeat: new Date(now - 45_000).toISOString(),
      runningRuns: 1,
      version: "0.42.1",
    },
    {
      id: "wrk-3c8e9f0a1d",
      host: "worker-3.gc.local",
      lastHeartbeat: new Date(now - 180_000).toISOString(),
      runningRuns: 0,
      version: "0.41.7",
    },
  ];
}

export const workersApi = {
  async list(): Promise<Worker[]> {
    const storage = safeGetStorage();
    if (storage) {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            return parsed as Worker[];
          }
        } catch {
          /* fallthrough */
        }
      }
      const seed = readSeed();
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(seed));
      } catch {
        /* ignore */
      }
      return seed;
    }
    return readSeed();
  },
};

const ONLINE_THRESHOLD_MS = 30_000;
const STALE_THRESHOLD_MS = 120_000;

export function statusFromHeartbeat(lastHeartbeat: string, now: number = Date.now()): WorkerStatus {
  const ts = new Date(lastHeartbeat).getTime();
  if (Number.isNaN(ts)) return "offline";
  const age = now - ts;
  if (age < ONLINE_THRESHOLD_MS) return "online";
  if (age < STALE_THRESHOLD_MS) return "stale";
  return "offline";
}

export function relativeTimeAgo(iso: string, now: number = Date.now()): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
