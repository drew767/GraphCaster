// Copyright GraphCaster. All Rights Reserved.

export interface ExecutionSummary {
  id: string;
  graphId: string;
  graphName: string;
  status: "success" | "failed" | "cancelled" | "running" | "waiting" | "queued";
  mode: "manual" | "webhook" | "schedule" | "trigger" | "api";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  retryOfRunId?: string;
  errorMessage?: string;
  totalTokens?: number;
  totalCostUsd?: number;
}

export interface ExecutionListParams {
  graphId?: string;
  status?: string;
  since?: string;
  limit: number;
  cursor?: string;
}

export interface ExecutionListResponse {
  items: ExecutionSummary[];
  total: number;
  nextCursor?: string;
}

export interface NodeExecutionSummary {
  nodeId: string;
  nodeName?: string;
  nodeType?: string;
  status: "success" | "failed" | "running" | "skipped" | "cancelled" | "waiting";
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  errorMessage?: string;
}

export interface ExecutionDetail extends ExecutionSummary {
  nodes: NodeExecutionSummary[];
  inputData?: unknown;
  outputData?: unknown;
}

export interface ExecutionEvent {
  type: string;
  nodeId?: string;
  timestamp?: string;
  payload?: unknown;
}
