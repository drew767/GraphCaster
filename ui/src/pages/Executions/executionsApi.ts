// Copyright GraphCaster. All Rights Reserved.

export type ExecutionStatus = "success" | "error" | "running" | "canceled";

export interface ExecutionNodePayload {
  id: string;
  name: string;
  status: ExecutionStatus;
  durationMs: number;
  input?: unknown;
  output?: unknown;
  parameters?: Record<string, unknown>;
  error?: string;
  position?: { x: number; y: number };
  type?: string;
}

export interface ExecutionEdgePayload {
  id: string;
  source: string;
  target: string;
}

export interface ExecutionPayload {
  runId: string;
  workflowId: string;
  workflowName: string;
  status: ExecutionStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs: number;
  nodes: ExecutionNodePayload[];
  edges?: ExecutionEdgePayload[];
}

const STORAGE_PREFIX = "gc.runs.";

function readLocalStorageRun(runId: string): ExecutionPayload | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + runId);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as ExecutionPayload;
    if (!parsed || typeof parsed !== "object" || !parsed.runId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export interface RetryOptions {
  fromNodeId?: string;
}

export interface ExecutionsApi {
  getExecution(runId: string): Promise<ExecutionPayload | null>;
  retry(runId: string, options?: RetryOptions): Promise<{ newRunId: string }>;
  delete(runId: string): Promise<void>;
}

export const executionsApi: ExecutionsApi = {
  async getExecution(runId) {
    return readLocalStorageRun(runId);
  },
  async retry(runId, options) {
    const newRunId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `retry-${Date.now()}`;
    const src = readLocalStorageRun(runId);
    if (src) {
      const clone: ExecutionPayload = {
        ...src,
        runId: newRunId,
        status: "running",
        startedAt: new Date().toISOString(),
        finishedAt: undefined,
        durationMs: 0,
      };
      try {
        window.localStorage.setItem(STORAGE_PREFIX + newRunId, JSON.stringify(clone));
      } catch {
        // ignore quota
      }
    }
    void options;
    return { newRunId };
  },
  async delete(runId) {
    try {
      window.localStorage.removeItem(STORAGE_PREFIX + runId);
    } catch {
      // ignore
    }
  },
};

export function writeMockRun(payload: ExecutionPayload): void {
  window.localStorage.setItem(STORAGE_PREFIX + payload.runId, JSON.stringify(payload));
}
