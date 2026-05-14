// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useRef, useState } from "react";

export interface ApiKey {
  id: string;
  label: string;
  keyMasked: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreateApiKeyResult {
  key: ApiKey;
  rawKey: string;
}

interface UseApiKeysDataReturn {
  keys: ApiKey[];
  loading: boolean;
  error: string | null;
  createKey: (label: string, scopes: string[]) => Promise<CreateApiKeyResult>;
  revokeKey: (id: string) => Promise<void>;
  refresh: () => void;
}

async function fetchKeys(): Promise<ApiKey[]> {
  const res = await fetch("/api/v1/api-keys");
  if (res.status === 404) {
    return [];
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = await res.json();
  return Array.isArray(data.keys) ? (data.keys as ApiKey[]) : [];
}

async function postKey(label: string, scopes: string[]): Promise<CreateApiKeyResult> {
  const res = await fetch("/api/v1/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, scopes }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json() as Promise<CreateApiKeyResult>;
}

async function deleteKey(id: string): Promise<void> {
  const res = await fetch(`/api/v1/api-keys/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`HTTP ${res.status}`);
  }
}

export function useApiKeysData(): UseApiKeysDataReturn {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchKeys();
      if (!mountedRef.current) return;
      setKeys(data);
    } catch (e) {
      if (!mountedRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const createKey = useCallback(async (label: string, scopes: string[]): Promise<CreateApiKeyResult> => {
    const result = await postKey(label, scopes);
    if (mountedRef.current) {
      setKeys((prev) => [result.key, ...prev]);
    }
    return result;
  }, []);

  const revokeKey = useCallback(async (id: string): Promise<void> => {
    await deleteKey(id);
    if (mountedRef.current) {
      setKeys((prev) => prev.filter((k) => k.id !== id));
    }
  }, []);

  return {
    keys,
    loading,
    error,
    createKey,
    revokeKey,
    refresh: load,
  };
}
