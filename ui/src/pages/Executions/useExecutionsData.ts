// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import type {
  ExecutionSummary,
  ExecutionListParams,
  ExecutionListResponse,
  ExecutionDetail,
} from "./types";

const API_BASE = "/api/v1";

async function fetchExecutions(
  params: ExecutionListParams,
): Promise<ExecutionListResponse> {
  const url = new URL(`${API_BASE}/runs`, window.location.origin);
  if (params.graphId) url.searchParams.set("graphId", params.graphId);
  if (params.status) url.searchParams.set("status", params.status);
  if (params.since) url.searchParams.set("since", params.since);
  url.searchParams.set("limit", String(params.limit));
  if (params.cursor) url.searchParams.set("cursor", params.cursor);

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    throw new Error(`Fetch executions failed: ${resp.status}`);
  }
  return resp.json() as Promise<ExecutionListResponse>;
}

async function fetchExecutionDetail(runId: string): Promise<ExecutionDetail> {
  const resp = await fetch(`${API_BASE}/runs/${encodeURIComponent(runId)}`);
  if (!resp.ok) {
    throw new Error(`Fetch execution detail failed: ${resp.status}`);
  }
  return resp.json() as Promise<ExecutionDetail>;
}

async function deleteExecution(runId: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/runs/${encodeURIComponent(runId)}`, {
    method: "DELETE",
  });
  if (!resp.ok) {
    throw new Error(`Delete execution failed: ${resp.status}`);
  }
}

async function retryExecution(runId: string): Promise<{ id: string }> {
  const resp = await fetch(
    `${API_BASE}/runs/${encodeURIComponent(runId)}/retry`,
    { method: "POST" },
  );
  if (!resp.ok) {
    throw new Error(`Retry execution failed: ${resp.status}`);
  }
  return resp.json() as Promise<{ id: string }>;
}

async function stopExecution(runId: string): Promise<void> {
  const resp = await fetch(
    `${API_BASE}/runs/${encodeURIComponent(runId)}/stop`,
    { method: "POST" },
  );
  if (!resp.ok) {
    throw new Error(`Stop execution failed: ${resp.status}`);
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface UseExecutionsDataOptions {
  graphId?: string;
  status?: string;
  since?: string;
  page: number;
  pageSize: number;
}

export interface UseExecutionsDataResult {
  items: ExecutionSummary[];
  total: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useExecutionsData(
  opts: UseExecutionsDataOptions,
): UseExecutionsDataResult {
  const [items, setItems] = React.useState<ExecutionSummary[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  const refresh = React.useCallback(() => setTick((t) => t + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchExecutions({
      graphId: opts.graphId,
      status: opts.status,
      since: opts.since,
      limit: opts.pageSize,
    })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load executions");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [opts.graphId, opts.status, opts.since, opts.page, opts.pageSize, tick]);

  return { items, total, loading, error, refresh };
}

export interface UseExecutionDetailResult {
  detail: ExecutionDetail | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useExecutionDetail(runId: string): UseExecutionDetailResult {
  const [detail, setDetail] = React.useState<ExecutionDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  const refresh = React.useCallback(() => setTick((t) => t + 1), []);

  React.useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchExecutionDetail(runId)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load execution");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [runId, tick]);

  return { detail, loading, error, refresh };
}

export { deleteExecution, retryExecution, stopExecution };
