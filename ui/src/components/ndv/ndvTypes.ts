// Copyright GraphCaster. All Rights Reserved.

export type NdvOnErrorMode = "stop" | "continue";

export type NdvRetryOnFail = {
  enabled: boolean;
  maxTries: number;
  waitMs: number;
};

export type NdvNodeSettings = {
  alwaysOutputData?: boolean;
  executeOnce?: boolean;
  retryOnFail?: NdvRetryOnFail;
  onError?: NdvOnErrorMode;
};

export type NdvParameterSchema = {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "select" | "credential" | "expression";
  credentialType?: string;
  required?: boolean;
  options?: ReadonlyArray<{ value: string; label: string }>;
  placeholder?: string;
  helperText?: string;
};

export type NdvNode = {
  id: string;
  type: string;
  data: Record<string, unknown> & {
    title?: string;
    note?: string;
    settings?: NdvNodeSettings;
  };
  docsMarkdown?: string;
  schema?: ReadonlyArray<NdvParameterSchema>;
};

export const NDV_RETRY_MIN = 1;
export const NDV_RETRY_MAX = 10;
export const NDV_RETRY_DEFAULT = 3;
export const NDV_RETRY_DEFAULT_WAIT_MS = 1000;

export function defaultRetryOnFail(): NdvRetryOnFail {
  return {
    enabled: false,
    maxTries: NDV_RETRY_DEFAULT,
    waitMs: NDV_RETRY_DEFAULT_WAIT_MS,
  };
}

export function normalizeRetryOnFail(value: unknown): NdvRetryOnFail {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return defaultRetryOnFail();
  }
  const r = value as Record<string, unknown>;
  const enabled = r.enabled === true;
  const rawMax = typeof r.maxTries === "number" && Number.isFinite(r.maxTries) ? r.maxTries : NDV_RETRY_DEFAULT;
  const maxTries = Math.min(NDV_RETRY_MAX, Math.max(NDV_RETRY_MIN, Math.floor(rawMax)));
  const rawWait =
    typeof r.waitMs === "number" && Number.isFinite(r.waitMs) ? r.waitMs : NDV_RETRY_DEFAULT_WAIT_MS;
  const waitMs = Math.max(0, Math.floor(rawWait));
  return { enabled, maxTries, waitMs };
}

export function normalizeNodeSettings(value: unknown): NdvNodeSettings {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const r = value as Record<string, unknown>;
  const result: NdvNodeSettings = {};
  if (r.alwaysOutputData === true) result.alwaysOutputData = true;
  if (r.executeOnce === true) result.executeOnce = true;
  if (r.retryOnFail != null) result.retryOnFail = normalizeRetryOnFail(r.retryOnFail);
  if (r.onError === "continue") result.onError = "continue";
  else if (r.onError === "stop") result.onError = "stop";
  return result;
}
