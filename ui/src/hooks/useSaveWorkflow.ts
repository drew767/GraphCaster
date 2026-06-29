// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppBannerStore } from "../app/stores/appBannerStore";
import { useAutosaveStore } from "../app/stores/autosaveStore";

const RETRY_DELAYS_MS = [1000, 2000, 4000];
const MAX_ATTEMPTS = 3;
const SAVE_RETRY_BANNER_ID = "gc.save.retrying";

export interface WorkflowSavePayload {
  id: string;
  [k: string]: unknown;
}

export interface UseSaveWorkflowOptions {
  /** Override the save endpoint. Defaults to `/api/v1/workflows/:id`. */
  endpoint?: (workflow: WorkflowSavePayload) => string;
  /** Override the fetch implementation (testing). */
  fetchImpl?: typeof fetch;
  /** Hook fired on success (e.g., apply server response to store). */
  onSuccess?: (workflow: WorkflowSavePayload, response: Response) => void;
  /** Hook fired on permanent failure (after retries are exhausted). */
  onError?: (error: Error, workflow: WorkflowSavePayload) => void;
}

export interface UseSaveWorkflowReturn {
  save: (workflow: WorkflowSavePayload) => Promise<void>;
  saving: boolean;
  lastSaved: number | null;
  error: Error | null;
  retry: () => Promise<void>;
}

function defaultEndpoint(workflow: WorkflowSavePayload): string {
  return `/api/v1/workflows/${encodeURIComponent(workflow.id)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Optimistic workflow save hook.
 *
 * - Optimistically resolves callbacks; the caller already reflected new state.
 * - On HTTP 503, retries with exponential backoff (1s → 2s → 4s, max 3
 *   attempts). During retry, pushes a banner "Saving failed — retrying…"
 *   that auto-dismisses on success.
 * - Other failures resolve `error` without retry.
 */
export function useSaveWorkflow(
  options: UseSaveWorkflowOptions = {},
): UseSaveWorkflowReturn {
  const { t } = useTranslation();
  const pushBanner = useAppBannerStore((s) => s.push);
  const dismissBanner = useAppBannerStore((s) => s.dismiss);
  const markSaving = useAutosaveStore((s) => s.markSaving);
  const markSaved = useAutosaveStore((s) => s.markSaved);
  const markError = useAutosaveStore((s) => s.markError);
  const registerRetry = useAutosaveStore((s) => s.registerRetry);
  const unregisterRetry = useAutosaveStore((s) => s.unregisterRetry);

  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Most recent workflow attempted; used by retry().
  const lastWorkflowRef = useRef<WorkflowSavePayload | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchImpl =
    options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  const endpoint = options.endpoint ?? defaultEndpoint;

  const doSave = useCallback(
    async (workflow: WorkflowSavePayload): Promise<void> => {
      if (!fetchImpl) {
        throw new Error("fetch is not available in this environment");
      }
      lastWorkflowRef.current = workflow;
      setSaving(true);
      setError(null);
      markSaving(workflow.id);

      let bannerShown = false;
      let attempt = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const res = await fetchImpl(endpoint(workflow), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(workflow),
          });
          if (res.status === 503 && attempt < MAX_ATTEMPTS) {
            if (!bannerShown) {
              bannerShown = true;
              pushBanner({
                id: SAVE_RETRY_BANNER_ID,
                type: "warning",
                message: t("save.retrying", "Saving failed — retrying…"),
                dismissible: false,
              });
            }
            const wait =
              RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
            attempt += 1;
            await delay(wait);
            continue;
          }
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          if (bannerShown) {
            dismissBanner(SAVE_RETRY_BANNER_ID);
          }
          const at = Date.now();
          if (mountedRef.current) {
            setLastSaved(at);
            setSaving(false);
            setError(null);
          }
          markSaved(workflow.id, at);
          options.onSuccess?.(workflow, res);
          return;
        } catch (e) {
          if (bannerShown) {
            dismissBanner(SAVE_RETRY_BANNER_ID);
          }
          const err = e instanceof Error ? e : new Error(String(e));
          if (mountedRef.current) {
            setSaving(false);
            setError(err);
          }
          markError(workflow.id, err);
          options.onError?.(err, workflow);
          return;
        }
      }
    },
    [
      fetchImpl,
      endpoint,
      pushBanner,
      dismissBanner,
      t,
      markSaving,
      markSaved,
      markError,
      options,
    ],
  );

  const retry = useCallback(async () => {
    const wf = lastWorkflowRef.current;
    if (!wf) return;
    await doSave(wf);
  }, [doSave]);

  // Register retry handler with the autosave store so AutosaveIndicator can
  // trigger a retry without binding directly to this hook.
  useEffect(() => {
    const wf = lastWorkflowRef.current;
    if (!wf) return;
    registerRetry(wf.id, retry);
    const id = wf.id;
    return () => {
      unregisterRetry(id);
    };
  }, [retry, registerRetry, unregisterRetry, lastSaved, error]);

  return {
    save: doSave,
    saving,
    lastSaved,
    error,
    retry,
  };
}
